"""
import_service.py - Transaction Import Business Logic

Two-step import: preview() parses an upload and annotates every row (account,
duplicate, zero amount, invalid date, transfer) without writing; confirm() writes the
rows the user approved, re-checking ownership and duplicates server-side.
Depends on import_parser for files, and db_service / account_service for data.
"""
from datetime import date, datetime
from services import import_parser
from services.db_service import DbService
from services.account_service import AccountService

db_service = DbService()
account_service = AccountService()

# Rows in these categories are pre-flagged as transfers in the preview
TRANSFER_CATEGORIES = ('transfer', 'payment')


class ImportService:

    # PREVIEW ===================================================================

    def preview(self, user_id, file, fallback_account_id=None):
        """
        Parse an uploaded file and return {rows, summary, unmatched_account_names}.
        Rows are matched to accounts by the file's 'account' column, or assigned
        fallback_account_id when the file has none. Writes nothing.
        Raises ValueError when the file can't be read.
        """
        df = import_parser.load_file(file)

        user_accounts    = db_service.get_user_accounts(user_id)
        accounts_by_key  = self._account_lookup(user_accounts)
        fallback_account = next((a for a in user_accounts if a.id == fallback_account_id), None)
        has_account_col  = 'account' in df.columns

        rows            = []
        unmatched_names = set()

        for _, record in df.iterrows():
            if has_account_col:
                raw_name = str(record.get('account', '')).strip()
                account  = accounts_by_key.get(raw_name.lower())
                if account:
                    account_id, account_name = account.id, account.acct_name
                else:
                    unmatched_names.add(raw_name)
                    account_id, account_name = None, raw_name
            else:
                account_id   = fallback_account_id
                account_name = fallback_account.acct_name if fallback_account else None

            rows.append(self._preview_row(record, account_id, account_name))

        return {
            'rows':                    rows,
            'summary':                 self._summary(rows),
            'unmatched_account_names': list(unmatched_names),
        }

    def _account_lookup(self, accounts):
        """Map each account's lowercased name and id string to the account."""
        lookup = {}
        for a in accounts:
            lookup[a.acct_name.lower().strip()]  = a
            lookup[a.acct_id_str.lower().strip()] = a
        return lookup

    def _preview_row(self, record, account_id, account_name):
        """
        Build one preview row from a normalized DataFrame record. A row whose date
        couldn't be read is flagged invalid_date and shows the original text as its date.
        """
        amount       = round(float(record['amount']), 2)
        amount_cents = int(round(amount * 100))
        date_obj     = record['date'] if isinstance(record['date'], date) else None

        zero_amount  = amount_cents == 0
        invalid_date = date_obj is None
        is_duplicate = (
            not zero_amount
            and not invalid_date
            and account_id is not None
            and db_service.transaction_exists(account_id, date_obj, record['vendor'], amount_cents)
        )

        category = str(record['category'])
        return {
            'date':         date_obj.isoformat() if date_obj else record['date_raw'],
            'vendor':       str(record['vendor']),
            'category':     category,
            'amount':       amount,
            'notes':        str(record.get('notes', '') or ''),
            'account_id':   account_id,
            'account_name': account_name,
            'duplicate':    is_duplicate,
            'zero_amount':  zero_amount,
            'invalid_date': invalid_date,
            'is_transfer':  category.strip().lower() in TRANSFER_CATEGORIES,
        }

    def _summary(self, rows):
        importable = sum(
            1 for r in rows
            if not r['duplicate']
            and not r['zero_amount']
            and not r['invalid_date']
            and r['account_id'] is not None
        )
        return {
            'total':        len(rows),
            'importable':   importable,
            'duplicates':   sum(r['duplicate'] for r in rows),
            'unmatched':    sum(r['account_id'] is None for r in rows),
            'zero_amount':  sum(r['zero_amount'] for r in rows),
            'invalid_date': sum(r['invalid_date'] for r in rows),
        }

    # CONFIRM ===================================================================

    def confirm(self, user_id, rows):
        """
        Write approved preview rows and return {imported, skipped, linked}.
        Rows are skipped when the account isn't the user's, a field is malformed,
        the amount is zero, or an identical transaction existed before this import.
        Every row is checked before any is inserted, so identical rows within the
        batch (two same-day purchases) are all kept. Balances of affected accounts
        are recalculated, then new transfers are linked to their counterparts.
        """
        user_account_ids = {a.id for a in db_service.get_user_accounts(user_id)}

        accepted = []
        for row in rows:
            fields = self._confirm_fields(row, user_account_ids)
            if fields and not db_service.transaction_exists(
                fields['account_id'], fields['date_obj'], fields['vendor'], fields['amount_cents']
            ):
                accepted.append(fields)

        new_transfers = []
        for fields in accepted:
            tx = account_service.add_transaction(
                account_id=fields['account_id'],
                date_obj=fields['date_obj'],
                vendor=fields['vendor'],
                category=fields['category'],
                amount=fields['amount'],
                notes=fields['notes'],
                is_transfer=fields['is_transfer'],
            )
            if fields['is_transfer']:
                new_transfers.append(tx)

        for aid in {fields['account_id'] for fields in accepted}:
            account_service.recalculate_account_balance(aid)

        return {
            'imported': len(accepted),
            'skipped':  len(rows) - len(accepted),
            'linked':   self._link_transfers(user_id, new_transfers),
        }

    def _confirm_fields(self, row, user_account_ids):
        """
        The values to insert for one approved row, or None when it must be skipped:
        not one of the user's accounts, a malformed field, or a zero amount.
        """
        account_id = row.get('account_id')
        if not account_id or account_id not in user_account_ids:
            return None

        try:
            amount = float(row['amount'])
            fields = {
                'account_id':   account_id,
                'date_obj':     datetime.fromisoformat(row['date']).date(),
                'amount':       amount,
                'amount_cents': int(round(amount * 100)),   # NaN / inf raise here
                'vendor':       str(row['vendor']),
                'category':     str(row['category']),
                'notes':        str(row.get('notes', '') or ''),
                'is_transfer':  bool(row.get('is_transfer', False)),
            }
        except (KeyError, ValueError, TypeError, OverflowError):
            return None

        return fields if fields['amount_cents'] != 0 else None

    def _link_transfers(self, user_id, transactions):
        """
        Link each new transfer to its counterpart (matched within this batch or among
        existing unlinked transfers). Returns how many links were made.
        """
        linked = 0
        for tx in transactions:
            if tx.transfer_peer_id is None:
                peer = db_service.find_transfer_peer(
                    user_id, tx.amount_cents, tx.date, tx.account_id, exclude_id=tx.id
                )
                if peer:
                    account_service.link_transfer(tx.id, peer.id)
                    linked += 1
        return linked
