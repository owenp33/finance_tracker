"""
account_service.py - Account & Transaction Business Logic

Orchestrates business rules around accounts, transactions, and recurring items.
Depends on db_service.py for raw data access.
"""
from datetime import date
from extensions import db
from models.transaction import TransactionModel
from models.recurring import RecurringModel
from services.db_service import DbService

db_service = DbService()


class AccountService:

    # ACCOUNT OPERATIONS ========================================================

    def update_account(self, account_id, data: dict):
        """
        Apply field updates to an account.
        Returns (updated_account, error_message).
        """
        account = db_service.get_account(account_id)
        if not account:
            return None, 'Account not found'

        if 'account_name' in data:
            account.acct_name = data['account_name']
        if 'account_id' in data:
            account.acct_id_str = data['account_id']

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

        db.session.delete(account)
        db.session.commit()
        return True, None

    # TRANSACTION OPERATIONS ====================================================

    def add_transaction(self, account_id, date_obj, vendor, category, amount, notes="", recurring_id=None, is_transfer=False):
        """
        Create a transaction, update the account balance, and re-evaluate
        over_budget flags for the category/period. Single commit for all writes.
        """
        transaction = TransactionModel(
            account_id=account_id,
            date=date_obj,
            vendor=vendor,
            category=category,
            notes=notes,
            recurring_id=recurring_id,
            is_transfer=is_transfer,
        )
        transaction.amount = amount

        account = db_service.get_account(account_id)
        if account:
            account.balance_cents += transaction.amount_cents

        db.session.add(transaction)
        db.session.flush()

        if transaction.amount_cents < 0:
            db_service._reevaluate_category_flags(
                user_id=account.user_id,
                category=category,
                period=date_obj.strftime('%Y-%m'),
            )

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
                old_account = db_service.get_account(old_account_id)
                new_account = db_service.get_account(new_account_id)
                if old_account:
                    old_account.balance_cents -= old_amount_cents
                if new_account:
                    new_account.balance_cents += trans.amount_cents
                trans.account_id = new_account_id
            elif 'amount' in update_fields:
                account = db_service.get_account(trans.account_id)
                if account:
                    account.balance_cents += (trans.amount_cents - old_amount_cents)

            db.session.commit()
            return trans, None

        except Exception as e:
            return None, str(e)

    def delete_transaction(self, transaction_id):
        """
        Delete a transaction, reverse its effect on the account balance, and
        re-evaluate over_budget flags for its category/period so that removing
        an expense that pushed the budget over clears the flag on remaining rows.
        Returns (success, error_message).
        """
        trans = db_service.get_transaction(transaction_id)
        if not trans:
            return False, 'Transaction not found'

        # Capture context before deletion — needed for re-evaluation after the row is gone
        was_expense  = trans.amount_cents < 0
        user_id      = trans.account.user_id
        category     = trans.category
        period       = trans.date.strftime('%Y-%m')

        account = db_service.get_account(trans.account_id)
        if account:
            account.balance_cents -= trans.amount_cents

        db.session.delete(trans)
        db.session.flush()   # remove the row from session before re-evaluation queries it

        if was_expense:
            db_service._reevaluate_category_flags(user_id, category, period)

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

    # RECURRING OPERATIONS ======================================================

    def add_recurring(self, account_id, start_date, vendor, category, amount,
                      next_date, frequency, number=-1, notes=""):
        """Create a recurring template and commit."""
        rec = RecurringModel(
            account_id=account_id,
            start_date=start_date,
            vendor=vendor,
            category=category,
            amount=amount,
            next_date=next_date,
            frequency=frequency,
            number=number,
            notes=notes,
            idx=1,
        )
        db.session.add(rec)
        db.session.commit()
        return rec

    def update_recurring(self, recurring_id, **kwargs):
        """
        Update a recurring transaction template and clean up excess generated
        transactions if the occurrence limit (number) was reduced.
        """
        rec = db_service.get_recurring(recurring_id)
        if not rec:
            return False

        old_number = rec.number

        updatable_fields = ['start_date', 'vendor', 'category', 'amount', 'notes', 'next_date', 'frequency', 'number']
        for field in updatable_fields:
            if field in kwargs:
                if field == 'amount':
                    rec.amount = kwargs[field]  # Property converts dollars to cents
                else:
                    setattr(rec, field, kwargs[field])

        new_number = rec.number
        number_was_reduced = new_number != -1 and (old_number == -1 or new_number < old_number)

        if number_was_reduced:
            all_generated = (
                TransactionModel.query
                .filter_by(recurring_id=recurring_id)
                .order_by(TransactionModel.date.asc(), TransactionModel.id.asc())
                .all()
            )
            excess = all_generated[new_number:]
            for trans in excess:
                account = db_service.get_account(trans.account_id)
                if account:
                    account.balance_cents -= trans.amount_cents
                db.session.delete(trans)

            kept = min(len(all_generated), new_number)
            rec.idx = kept + 1

        db.session.commit()
        return rec

    def delete_recurring(self, recurring_id, delete_generated=False):
        """
        Delete a recurring transaction template.
        If delete_generated=True, also deletes all auto-generated transactions
        from this recurring and reverses their effect on the account balance.
        Otherwise, those transactions are kept but unlinked from the recurring.
        """
        rec = db_service.get_recurring(recurring_id)
        if not rec:
            return False

        if delete_generated:
            transactions = TransactionModel.query.filter_by(recurring_id=recurring_id).all()
            for trans in transactions:
                account = db_service.get_account(trans.account_id)
                if account:
                    account.balance_cents -= trans.amount_cents
                db.session.delete(trans)
        else:
            TransactionModel.query.filter_by(recurring_id=recurring_id).update({'recurring_id': None})

        db.session.delete(rec)
        db.session.commit()
        return True

    def process_due_recurring(self, account_id):
        """
        Generate transactions for all due recurring items. Intended to be called
        on user login. Returns the number of transactions created.
        """
        recurring_list = db_service.get_account_recurring(account_id)
        transactions_created = 0
        today = date.today()

        for rec in recurring_list:
            while rec.next_date <= today and (rec.number == -1 or rec.idx <= rec.number):
                self.add_transaction(
                    account_id=account_id,
                    date_obj=rec.next_date,
                    vendor=rec.vendor,
                    category=rec.category,
                    amount=rec.amount,
                    notes=f"Auto-generated from recurring: {rec.notes}",
                    recurring_id=rec.id
                )

                rec.next_date = rec.advance_to_next
                rec.idx += 1
                transactions_created += 1

                if rec.number != -1 and rec.idx > rec.number:
                    break

        db.session.commit()   # persist rec.next_date updates
        return transactions_created

    # UTILITY OPERATIONS ========================================================

    def recalculate_account_balance(self, account_id):
        """Audit helper to ensure balance matches sum of transaction history"""
        account = db_service.get_account(account_id)
        if account:
            total_cents = sum(trans.amount_cents for trans in account.transactions)
            account.balance_cents = total_cents
            db.session.commit()
            return total_cents / 100.0
        return 0