"""
account_service.py - Account & Transaction Business Logic

Orchestrates business rules around accounts, transactions, and transfers (recurring
templates live in recurring_service.py).
Depends on db_service.py for raw data access.
"""
import math
import numbers
from extensions import db
from models.account import AccountModel
from models.transaction import TransactionModel
from services.db_service import DbService

db_service = DbService()


def _account_label(value, column, shown_as):
    """
    The trimmed value for an account's name or id string column. Raises ValueError, naming
    the field as the edit form shows it, when the value isn't text, is blank, or is too long.
    """
    if not isinstance(value, str):
        raise ValueError(f'{shown_as} must be text.')
    label = value.strip()
    if not label:
        raise ValueError(f"{shown_as} can't be empty.")
    if len(label) > column.type.length:
        raise ValueError(f'{shown_as} must be at most {column.type.length} characters.')
    return label


# Dollars. Keeps balance_cents (a 32-bit INTEGER in Postgres) far from overflowing.
MAX_OPENING_BALANCE = 10_000_000


def _opening_balance(value):
    """The starting balance in dollars. Raises ValueError unless it's a finite number within ±MAX_OPENING_BALANCE."""
    if isinstance(value, bool) or not isinstance(value, numbers.Real) or not math.isfinite(value):
        raise ValueError('Starting balance must be a number.')
    if abs(value) > MAX_OPENING_BALANCE:
        raise ValueError(f'Starting balance must be between -${MAX_OPENING_BALANCE:,} and ${MAX_OPENING_BALANCE:,}.')
    return value


class AccountService:

    # ACCOUNT OPERATIONS ========================================================

    def update_account(self, account_id, data: dict):
        """
        Apply field updates to an account. Editing the name, id string, or starting balance
        (opening_balance, in dollars), or sending needs_attention=False ("Looks good"), marks an
        import-created account as reviewed. Names and id strings are trimmed; changing the
        starting balance moves the balance by the same amount. Returns (updated_account,
        error_message); raises ValueError for invalid input, before changing anything.
        """
        account = db_service.get_account(account_id)
        if not account:
            return None, 'Account not found'

        # Validate every field before changing any
        if 'needs_attention' in data and data['needs_attention'] is not False:
            raise ValueError('needs_attention can only be set to false')
        name = account.acct_name
        if 'account_name' in data:
            name = _account_label(data['account_name'], AccountModel.acct_name, 'Display name')
        id_str = account.acct_id_str
        if 'account_id' in data:
            id_str = _account_label(data['account_id'], AccountModel.acct_id_str, 'Account ID')
        opening = account.opening_balance
        if 'opening_balance' in data:
            opening = _opening_balance(data['opening_balance'])

        account.acct_name   = name
        account.acct_id_str = id_str
        # The balance includes the starting balance, so it moves by the same difference
        old_opening_cents = account.opening_balance_cents
        account.opening_balance = opening
        db_service.adjust_balance(account.id, account.opening_balance_cents - old_opening_cents)
        if {'needs_attention', 'account_name', 'account_id', 'opening_balance'} & data.keys():
            account.needs_attention = False

        db.session.commit()
        return account, None

    def delete_account(self, account_id):
        """
        Delete an account. Cascade rules on the model remove all associated
        transactions and recurring items automatically.
        Returns (success, error_message).
        """
        account = db_service.get_account(account_id)
        if not account:
            return False, 'Account not found'

        # Unlink any transfer peers before the cascade delete to avoid
        # SQLAlchemy circular-FK conflicts (same issue as delete_transaction).
        transfer_ids = [t.id for t in account.transactions if t.is_transfer]
        for tx_id in transfer_ids:
            self.unlink_transfer(tx_id)

        account = db_service.get_account(account_id)
        db.session.delete(account)
        db.session.commit()
        return True, None

    # TRANSACTION OPERATIONS ====================================================

    def add_transaction(self, account_id, date_obj, vendor, category, amount, notes="", recurring_id=None, recurring_index=None, is_transfer=False, is_reimbursement=False):
        """
        Create a transaction and update the account balance. Single commit for all writes.
        """
        transaction = TransactionModel(
            account_id=account_id,
            date=date_obj,
            vendor=vendor,
            category=category,
            notes=notes,
            recurring_id=recurring_id,
            recurring_index=recurring_index,
            is_transfer=is_transfer,
            is_reimbursement=is_reimbursement,
        )
        transaction.amount = amount

        account = db_service.get_account(account_id)
        db.session.add(transaction)
        db.session.flush()
        if account:
            db_service.adjust_balance(account_id, transaction.amount_cents)

        db.session.commit()
        return transaction

    def get_transaction_authorized(self, transaction_id, user_id):
        """
        Fetch a transaction and verify it belongs to the requesting user.
        Returns (transaction, error_message, status_code).
        On success, error and status are None. On failure, transaction is None.
        """
        trans = db_service.get_transaction(transaction_id)
        if not trans:
            return None, 'Transaction not found', 404
        if int(trans.account.user_id) != int(user_id):
            return None, 'Unauthorized', 403
        return trans, None, None

    def update_transaction(self, transaction_id, data: dict):
        """
        Parse raw request data and update a transaction.
        Handles type coercion so routes don't have to.
        Returns (updated_transaction, error_message).
        """
        trans = db_service.get_transaction(transaction_id)
        if not trans:
            return None, 'Transaction not found'

        try:
            update_fields = {}
            if 'date' in data:
                from datetime import datetime
                update_fields['date'] = datetime.fromisoformat(data['date']).date()
            if 'vendor' in data:
                update_fields['vendor'] = data['vendor']
            if 'category' in data:
                update_fields['category'] = data['category']
            if 'amount' in data:
                update_fields['amount'] = float(data['amount'])
            if 'notes' in data:
                update_fields['notes'] = data['notes']

            old_amount_cents = trans.amount_cents
            old_account_id = trans.account_id

            for key, value in update_fields.items():
                if hasattr(trans, key) and key != 'id':
                    if key == 'amount':
                        trans.amount = value
                    else:
                        setattr(trans, key, value)

            # Handle account change: reverse from old account, apply to new account
            new_account_id = int(data['account_id']) if 'account_id' in data else old_account_id
            if new_account_id != old_account_id:
                if db_service.get_account(old_account_id):
                    db_service.adjust_balance(old_account_id, -old_amount_cents)
                if db_service.get_account(new_account_id):
                    db_service.adjust_balance(new_account_id, trans.amount_cents)
                trans.account_id = new_account_id
            elif 'amount' in update_fields:
                db_service.adjust_balance(trans.account_id, trans.amount_cents - old_amount_cents)

            if 'is_reimbursement' in data:
                trans.is_reimbursement = bool(data['is_reimbursement'])

            # Sync shared fields to the linked transfer peer (amount is negated on the peer)
            if trans.is_transfer and trans.transfer_peer_id:
                peer = db_service.get_transaction(trans.transfer_peer_id)
                if peer:
                    old_peer_amount_cents = peer.amount_cents
                    if 'date' in update_fields: peer.date = trans.date
                    if 'vendor' in update_fields: peer.vendor = trans.vendor
                    if 'category' in update_fields: peer.category = trans.category
                    if 'notes' in update_fields: peer.notes = trans.notes
                    if 'amount' in update_fields:
                        peer.amount = -update_fields['amount']
                        db_service.adjust_balance(peer.account_id, peer.amount_cents - old_peer_amount_cents)

            db.session.commit()
            return trans, None

        except Exception as e:
            return None, str(e)

    def delete_transaction(self, transaction_id):
        """
        Delete a transaction and reverse its effect on the account balance; a generated
        recurring transaction also shrinks its series. Returns (success, error_message).
        """
        trans = db_service.get_transaction(transaction_id)
        if not trans:
            return False, 'Transaction not found'

        # Clear transfer link before deleting to avoid SQLAlchemy circular-FK conflicts.
        # unlink_transfer commits, so we re-fetch a clean session state afterward.
        if trans.is_transfer:
            self.unlink_transfer(transaction_id)
            trans = db_service.get_transaction(transaction_id)
            if not trans:
                return False, 'Transaction not found'

        # Capture the series position before the row is gone
        recurring_id  = trans.recurring_id
        deleted_index = trans.recurring_index

        db_service.adjust_balance(trans.account_id, -trans.amount_cents)
        db.session.delete(trans)
        db.session.flush()   # remove the row from the session before the series is renumbered

        # When a generated recurring transaction is deleted, shift sibling indices
        # so the "X/Y" card numbers on the remaining transactions stay contiguous.
        if recurring_id is not None and deleted_index is not None:
            rec = db_service.get_recurring(recurring_id)
            if rec:
                rec.idx = max(0, rec.idx - 1)
                if rec.number > 0:
                    rec.number -= 1
                (TransactionModel.query
                 .filter(
                     TransactionModel.recurring_id == recurring_id,
                     TransactionModel.recurring_index > deleted_index,
                 )
                 .update(
                     {'recurring_index': TransactionModel.recurring_index - 1},
                     synchronize_session='fetch',
                 ))

        db.session.commit()
        return True, None

    def link_transfer(self, tx_id, peer_id):
        """
        Mark two transactions as the two sides of a transfer and link them.
        Both are flagged is_transfer=True and each points to the other via transfer_peer_id.
        Returns (success, error_message).
        """
        tx   = db_service.get_transaction(tx_id)
        peer = db_service.get_transaction(peer_id)
        if not tx or not peer:
            return False, 'Transaction not found'
        tx.is_transfer       = True
        tx.transfer_peer_id  = peer_id
        peer.is_transfer     = True
        peer.transfer_peer_id = tx_id
        db.session.commit()
        return True, None

    def unlink_transfer(self, tx_id):
        """
        Remove the transfer link from a transaction and its peer (if any).
        Both sides lose their is_transfer flag and transfer_peer_id.
        Returns (success, error_message).
        """
        tx = db_service.get_transaction(tx_id)
        if not tx:
            return False, 'Transaction not found'
        if tx.transfer_peer_id:
            peer = db_service.get_transaction(tx.transfer_peer_id)
            if peer:
                peer.transfer_peer_id = None
                peer.is_transfer      = False
        tx.transfer_peer_id = None
        tx.is_transfer      = False
        db.session.commit()
        return True, None

    def break_transfer_link(self, tx_id):
        """
        Clear the peer link between two transfer transactions without removing
        the is_transfer flag. Both sides remain visible as unlinked transfers,
        ready to be re-paired to the correct account.

        Distinct from unlink_transfer, which fully removes the is_transfer flag.
        Returns (success, error_message).
        """
        tx = db_service.get_transaction(tx_id)
        if not tx:
            return False, 'Transaction not found'
        if tx.transfer_peer_id:
            peer = db_service.get_transaction(tx.transfer_peer_id)
            if peer:
                peer.transfer_peer_id = None
        tx.transfer_peer_id = None
        db.session.commit()
        return True, None

    def create_transfer_pair(self, tx_id, to_account_id):
        """
        Ensure tx is paired with a counterpart on to_account_id.

        Three cases:
          - No existing peer: creates one.
          - Existing peer already on to_account_id: no-op, returns existing pair.
          - Existing peer on a different account: deletes old peer (reversing its
            balance effect) then creates a new one on to_account_id.

        Uses a single commit to avoid SQLAlchemy session expiry issues that arise
        when add_transaction commits mid-function and invalidates in-flight objects.

        Returns (original_tx, peer_tx, error_message).
        """
        tx = db_service.get_transaction(tx_id)
        if not tx:
            return None, None, 'Transaction not found'

        if tx.transfer_peer_id:
            old_peer = db_service.get_transaction(tx.transfer_peer_id)
            if old_peer and old_peer.account_id == to_account_id:
                return tx, old_peer, None  # already paired correctly, nothing to do
            if old_peer:
                old_peer.transfer_peer_id = None
                tx.transfer_peer_id = None
                db.session.flush()
                db_service.adjust_balance(old_peer.account_id, -old_peer.amount_cents)
                db.session.delete(old_peer)
            else:
                tx.transfer_peer_id = None

        # Create peer inline without an intermediate commit so tx stays valid.
        peer = TransactionModel(
            account_id=to_account_id,
            date=tx.date,
            vendor=tx.vendor,
            category=tx.category,
            notes=tx.notes or '',
            is_transfer=True,
        )
        peer.amount = -tx.amount

        db.session.add(peer)
        db.session.flush()  # assigns peer.id
        db_service.adjust_balance(to_account_id, peer.amount_cents)

        tx.is_transfer        = True
        tx.transfer_peer_id   = peer.id
        peer.transfer_peer_id = tx.id
        db.session.commit()

        return tx, peer, None

    # UTILITY OPERATIONS ========================================================

    def recalculate_account_balance(self, account_id):
        """Reset the balance to the starting balance plus the account's transactions; returns it in dollars."""
        account = db_service.get_account(account_id)
        if account:
            db_service.recompute_balance(account_id)
            db.session.commit()
            return account.balance
        return 0