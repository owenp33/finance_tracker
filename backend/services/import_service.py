"""
import_service.py - Transaction Import Business Logic

Two-step import: preview() parses an upload and annotates every row (account,
duplicate, zero amount, invalid date/amount, transfer, a matching recurring series
transaction) without writing; confirm() writes the rows the user approved, re-checking
ownership, duplicates and recurring replacements server-side.
Rows whose account isn't found can create new accounts (flagged needs_attention),
go into one of the user's existing accounts, or be skipped.
Depends on import_parser for files, vendor_match for recurring matches, and
db_service / account_service for data.
"""
import math
import numbers
from collections import defaultdict
from datetime import date, datetime, timedelta
from models.account import AccountModel
from models.recurring import MATCH_WINDOW_DAYS
from services import import_parser
from services.db_service import DbService
from services.account_service import AccountService
from services.recurring_service import RecurringService
from services.vendor_match import amount_close, vendor_key, vendor_match

db_service = DbService()
account_service = AccountService()
recurring_service = RecurringService()

# Rows in these categories are pre-flagged as transfers in the preview
TRANSFER_CATEGORIES = ('transfer', 'payment')

# What to do with rows whose account isn't found: create it, use an existing account, or skip
UNMATCHED_OPTIONS = ('create', 'account', 'skip')

# A malformed account column must not flood the user's account list
MAX_NEW_ACCOUNTS = 25

ACCOUNT_NAME_LENGTH = AccountModel.acct_name.type.length


def _account_key(name):
    """How account names are compared: ignoring case and surrounding whitespace."""
    return name.strip().lower()


def _match_kind(vendor, amount_cents, day, t):
    """
    How a file row's vendor matches the series transaction t ('exact' or 'similar'), or None when
    the row can't be t's charge: more than MATCH_WINDOW_DAYS apart, an amount that isn't close,
    or another vendor. The series' names are the template's vendor, t's own and the aliases.
    """
    if abs((t.date - day).days) > MATCH_WINDOW_DAYS or not amount_close(amount_cents, t.amount_cents):
        return None
    rec = t.recurring_source
    return vendor_match(vendor, (rec.vendor, t.vendor), {a.alias for a in rec.aliases})


class ImportService:

    # PREVIEW ===================================================================

    def preview(self, user_id, file, unmatched='create', target_account_id=None):
        """
        Parse an uploaded file and return {rows, summary, unmatched_account_names}.
        Rows are matched to accounts by the file's 'account' column. Rows whose account
        isn't found, and every row of a file without an account column, follow `unmatched`:
          'create'  -> a new account named after the row's account value (or the file name);
                       the row is marked new_account and the account is created on confirm
          'account' -> the user's account target_account_id
          'skip'    -> left unmatched, so the row can't be imported
        Writes nothing. Raises ValueError when the options are invalid, the file can't
        be read, or it would create more than MAX_NEW_ACCOUNTS accounts.
        """
        user_accounts   = db_service.get_user_accounts(user_id)
        accounts_by_key = self._account_lookup(user_accounts)
        target          = self._unmatched_target(unmatched, target_account_id, user_accounts)

        df                = import_parser.load_file(file)
        has_account_col   = 'account' in df.columns
        file_account_name = self._file_account_name(file)

        rows            = []
        unmatched_names = {}   # account key -> first spelling seen, for names not found
        new_names       = {}   # account key -> first spelling seen, for accounts to create

        for _, record in df.iterrows():
            raw_name = record['account'] if has_account_col else ''
            if raw_name and _account_key(raw_name) not in accounts_by_key:
                unmatched_names.setdefault(_account_key(raw_name), raw_name)

            account_id, account_name, new_account = self._resolve_account(
                raw_name, accounts_by_key, unmatched, target, file_account_name
            )
            if new_account:
                account_name = new_names.setdefault(_account_key(account_name), account_name)

            rows.append(self._preview_row(record, account_id, account_name, new_account))

        self._match_recurring(rows)
        summary = self._summary(rows)
        self._check_new_account_limit(len(summary['new_accounts']))

        return {
            'rows':                    rows,
            'summary':                 summary,
            'unmatched_account_names': list(unmatched_names.values()),
        }

    def _account_lookup(self, accounts):
        """Map each account's name and id string (compared via _account_key) to the account."""
        lookup = {}
        for a in accounts:
            lookup[_account_key(a.acct_name)]   = a
            lookup[_account_key(a.acct_id_str)] = a
        return lookup

    def _unmatched_target(self, unmatched, target_account_id, user_accounts):
        """Validate the unmatched-rows option; return the target account for 'account', else None."""
        if unmatched not in UNMATCHED_OPTIONS:
            raise ValueError(f'Unknown option for unmatched accounts: {unmatched}')
        if unmatched != 'account':
            return None

        target = next((a for a in user_accounts if a.id == target_account_id), None)
        if target is None:
            raise ValueError('Choose one of your accounts for the unmatched rows')
        return target

    def _file_account_name(self, file):
        """Name for rows without an account value: the uploaded file's name minus its extension."""
        filename = (getattr(file, 'filename', '') or '').replace('\\', '/').rsplit('/', 1)[-1]
        stem     = filename.rsplit('.', 1)[0] if '.' in filename else filename
        return stem.strip()[:ACCOUNT_NAME_LENGTH] or 'Imported'

    def _resolve_account(self, raw_name, accounts_by_key, unmatched, target, file_account_name):
        """
        (account_id, account_name, new_account) for one preview row. raw_name is the
        row's account value: '' when the cell is blank or the file has no account column.
        """
        if raw_name:
            account = accounts_by_key.get(_account_key(raw_name))
            if account:
                return account.id, account.acct_name, False

        if unmatched == 'account':
            return target.id, target.acct_name, False
        if unmatched == 'skip':
            return None, raw_name or None, False

        name = (raw_name or file_account_name)[:ACCOUNT_NAME_LENGTH]
        existing = accounts_by_key.get(_account_key(name))   # e.g. created by an earlier import of this file
        if existing:
            return existing.id, existing.acct_name, False
        return None, name, True

    def _preview_row(self, record, account_id, account_name, new_account):
        """
        Build one preview row from a normalized DataFrame record. A date or amount
        that couldn't be read is flagged (invalid_date / invalid_amount) and the row
        shows the original text in that field instead.
        """
        amount   = self._amount(record['amount'])
        date_obj = record['date'] if isinstance(record['date'], date) else None

        invalid_amount = amount is None
        invalid_date   = date_obj is None
        amount_cents   = None if invalid_amount else int(round(amount * 100))
        zero_amount    = amount_cents == 0
        is_duplicate   = (
            not zero_amount
            and not invalid_amount
            and not invalid_date
            and account_id is not None
            and db_service.transaction_exists(account_id, date_obj, record['vendor'], amount_cents)
        )

        category = str(record['category'])
        return {
            'date':           date_obj.isoformat() if date_obj else record['date_raw'],
            'vendor':         str(record['vendor']),
            'category':       category,
            'amount':         record['amount_raw'] if invalid_amount else amount,
            'notes':          str(record.get('notes', '') or ''),
            'account_id':     account_id,
            'account_name':   account_name,
            'new_account':    new_account,
            'duplicate':      is_duplicate,
            'zero_amount':    zero_amount,
            'invalid_date':   invalid_date,
            'invalid_amount': invalid_amount,
            'is_transfer':    category.strip().lower() in TRANSFER_CATEGORIES,
            'recurring_match': None,   # set by _match_recurring
        }

    def _match_recurring(self, rows):
        """
        Set recurring_match on each importable row that looks like a transaction already in a
        recurring series (_match_kind): same account, within ±MATCH_WINDOW_DAYS, a vendor exact
        or similar to the series' names, and an amount within vendor_match's tolerance.
        A series transaction with an exact copy in the file (a duplicate row) is already
        covered. Each row and each series transaction is claimed at most once: an exact vendor
        and amount first, then the closer amount, then the nearer date.
        """
        candidates = [
            (index, row, date.fromisoformat(row['date']), int(round(row['amount'] * 100)))
            for index, row in enumerate(rows)
            if row['account_id'] is not None and self._importable(row)
        ]
        if not candidates:
            return

        window = timedelta(days=MATCH_WINDOW_DAYS)
        days   = [day for _, _, day, _ in candidates]
        copied = {(r['account_id'], r['date'], vendor_key(r['vendor']), int(round(r['amount'] * 100)))
                  for r in rows if r['duplicate']}
        series_by_day = defaultdict(list)   # (account id, date) -> series transactions
        for t in db_service.get_series_transactions({row['account_id'] for _, row, _, _ in candidates},
                                                    min(days) - window, max(days) + window):
            if (t.account_id, t.date.isoformat(), vendor_key(t.vendor), t.amount_cents) not in copied:
                series_by_day[(t.account_id, t.date)].append(t)

        pairs = []
        for index, row, day, cents in candidates:
            for offset in range(-MATCH_WINDOW_DAYS, MATCH_WINDOW_DAYS + 1):
                for t in series_by_day.get((row['account_id'], day + timedelta(days=offset)), ()):
                    vendor = _match_kind(row['vendor'], cents, day, t)
                    if vendor:
                        exact = vendor == 'exact' and cents == t.amount_cents
                        rank  = (not exact, abs(cents - t.amount_cents), abs(offset), vendor != 'exact', index, t.id)
                        pairs.append((rank, index, t, vendor, cents))

        claimed_rows, claimed_series = set(), set()
        for _, index, t, vendor, cents in sorted(pairs, key=lambda pair: pair[0]):
            if index in claimed_rows or t.id in claimed_series:
                continue
            claimed_rows.add(index)
            claimed_series.add(t.id)
            rows[index]['recurring_match'] = {
                'transaction_id':   t.id,
                'recurring_id':     t.recurring_id,
                'vendor':           t.recurring_source.vendor,
                'date':             t.date.isoformat(),
                'amount':           t.amount,
                'similar_vendor':   vendor == 'similar',
                'different_amount': cents != t.amount_cents,
            }

    @staticmethod
    def _amount(value):
        """The parsed amount rounded to cents, or None when the parser couldn't read one (None or NaN)."""
        if isinstance(value, numbers.Real) and math.isfinite(value):
            return round(float(value), 2)
        return None

    @staticmethod
    def _importable(row):
        """True when nothing stops a preview row from being imported."""
        return (
            (row['account_id'] is not None or row['new_account'])
            and not row['duplicate']
            and not row['zero_amount']
            and not row['invalid_date']
            and not row['invalid_amount']
        )

    def _summary(self, rows):
        importable = [r for r in rows if self._importable(r)]
        return {
            'total':          len(rows),
            'importable':     len(importable),
            'duplicates':     sum(r['duplicate'] for r in rows),
            'unmatched':      sum(r['account_id'] is None and not r['new_account'] for r in rows),
            'zero_amount':    sum(r['zero_amount'] for r in rows),
            'invalid_date':   sum(r['invalid_date'] for r in rows),
            'invalid_amount': sum(r['invalid_amount'] for r in rows),
            'recurring_matches': sum(r['recurring_match'] is not None for r in rows),
            # Accounts confirm would create: only those with at least one importable row
            'new_accounts':   list(dict.fromkeys(r['account_name'] for r in importable if r['new_account'])),
        }

    @staticmethod
    def _check_new_account_limit(count):
        if count > MAX_NEW_ACCOUNTS:
            raise ValueError(
                f'This import would create {count} new accounts (the limit is {MAX_NEW_ACCOUNTS}). '
                "Check the file's account column, or choose another option."
            )

    # CONFIRM ===================================================================

    def confirm(self, user_id, rows):
        """
        Write approved preview rows and return {imported, replaced, skipped, linked,
        created_accounts}.
        Rows are skipped when they aren't objects, the account isn't the user's (or a new
        account has no usable name), a field is malformed, the amount is zero, or an
        identical transaction existed before this import. Every row is checked before
        any is inserted, so identical rows within the batch (two same-day purchases)
        are all kept.
        A row with replaces_transaction_id (the preview's recurring_match, confirmed by the
        user) updates that series transaction instead of adding one (replace_occurrence);
        it's re-checked with the preview's rule on the row's own account, and skipped when
        it doesn't check out or another row already replaces that transaction. Confirming a
        similar vendor remembers its spelling as an alias of the series.
        Rows marked new_account create one account per name, flagged needs_attention,
        reusing an account that matches by now; only accounts with at least one accepted
        row are created. Raises ValueError, before writing anything, when more than
        MAX_NEW_ACCOUNTS would be created. Balances of affected accounts are then
        recalculated and new transfers linked to their counterparts.
        """
        user_accounts    = db_service.get_user_accounts(user_id)
        user_account_ids = {a.id for a in user_accounts}
        accounts_by_key  = self._account_lookup(user_accounts)

        accepted     = []
        new_names    = {}      # account key -> first spelling seen
        replaced_ids = set()   # series transactions a row of this import replaces
        for row in rows:
            if not isinstance(row, dict):
                continue
            fields = self._confirm_fields(row)
            if fields is None:
                continue

            account_id, new_name = self._confirm_account(row, user_account_ids, accounts_by_key)
            if account_id is None and not new_name:
                continue
            if account_id is not None and db_service.transaction_exists(
                account_id, fields['date_obj'], fields['vendor'], fields['amount_cents']
            ):
                continue

            fields['replaces'] = None
            if row.get('replaces_transaction_id') is not None:
                fields['replaces'] = self._confirm_replacement(
                    row['replaces_transaction_id'], fields, account_id, replaced_ids
                )
                if fields['replaces'] is None:
                    continue
                replaced_ids.add(fields['replaces'][0].id)

            if account_id is None:
                new_names.setdefault(_account_key(new_name), new_name)
            fields['account_id']      = account_id
            fields['new_account_key'] = None if account_id is not None else _account_key(new_name)
            accepted.append(fields)

        self._check_new_account_limit(len(new_names))
        created_ids = {
            key: db_service.create_account(user_id, name, name, needs_attention=True).id
            for key, name in new_names.items()
        }

        new_transfers = []
        for fields in accepted:
            if fields['account_id'] is None:
                fields['account_id'] = created_ids[fields['new_account_key']]
            if fields['replaces']:
                series_tx, vendor = fields['replaces']
                recurring_service.replace_occurrence(series_tx.id, fields['date_obj'],
                                                     fields['amount_cents'], fields['notes'])
                if vendor == 'similar':
                    recurring_service.remember_alias(series_tx.recurring_id, fields['vendor'])
                continue
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

        replaced = sum(fields['replaces'] is not None for fields in accepted)
        return {
            'imported':         len(accepted) - replaced,
            'replaced':         replaced,
            'skipped':          len(rows) - len(accepted),
            'linked':           self._link_transfers(user_id, new_transfers),
            'created_accounts': list(new_names.values()),
        }

    def _confirm_fields(self, row):
        """The values to insert for one approved row, or None when a field is malformed or the amount is zero."""
        try:
            amount = float(row['amount'])
            fields = {
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

    def _confirm_account(self, row, user_account_ids, accounts_by_key):
        """
        Where an approved row goes: (account_id, None) for one of the user's accounts,
        (None, name) for a new account to create, or (None, None) to skip the row.
        """
        account_id = row.get('account_id')
        if account_id:
            return (account_id, None) if account_id in user_account_ids else (None, None)

        name = row.get('account_name')
        if not row.get('new_account') or not isinstance(name, str) or not name.strip():
            return None, None

        name     = name.strip()[:ACCOUNT_NAME_LENGTH]
        existing = accounts_by_key.get(_account_key(name))
        return (existing.id, None) if existing else (None, name)

    def _confirm_replacement(self, transaction_id, fields, account_id, claimed):
        """
        (series transaction, vendor match) for an approved row that replaces transaction_id,
        re-checked with the preview's rule (_match_kind) on the row's own account (one of the
        user's, so the transaction is too); None when it doesn't check out or the transaction
        is already in `claimed`.
        """
        if account_id is None or isinstance(transaction_id, bool) or not isinstance(transaction_id, int):
            return None
        t = db_service.get_transaction(transaction_id)
        if t is None or t.recurring_id is None or t.account_id != account_id or t.id in claimed:
            return None
        vendor = _match_kind(fields['vendor'], fields['amount_cents'], fields['date_obj'], t)
        return (t, vendor) if vendor else None

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
