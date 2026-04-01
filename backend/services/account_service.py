"""
account_service.py - Account & Transaction Business Logic

Orchestrates business rules around accounts, transactions, and recurring items.
Depends on db_service.py for raw data access.
"""
from datetime import date, timedelta
from extensions import db
from models.transaction import TransactionModel
from models.recurring import RecurringModel
from services.db_service import DbService

db_service = DbService()


class AccountService:

    # TRANSACTION OPERATIONS ====================================================

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
            
            for key, value in update_fields.items():
                if hasattr(trans, key) and key != 'id':
                    if key == 'amount':
                        trans.amount = value  # Property setter converts dollars to cents
                    else:
                        setattr(trans, key, value)

            if 'amount' in update_fields:
                account = db_service.get_account(trans.account_id)
                if account:
                    account.balance_cents += (trans.amount_cents - old_amount_cents)

            db.session.commit()
            return trans, None

        except Exception as e:
            return None, str(e)

    def delete_transaction(self, transaction_id):
        """
        Delete a transaction and reverse its effect on the account balance.
        Returns (success, error_message).
        """
        t = db_service.get_transaction(transaction_id)
        if not t:
            return False, 'Transaction not found'

        account = db_service.get_account(t.account_id)
        if account:
            account.balance_cents -= t.amount_cents

        db.session.delete(t)
        db.session.commit()
        return True, None

    # RECURRING OPERATIONS ======================================================

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
            cutoff_date = rec.start_date + timedelta(days=rec.frequency * (new_number - 1))

            excess_transactions = TransactionModel.query.filter(
                TransactionModel.recurring_id == recurring_id,
                TransactionModel.date >= cutoff_date
            ).all()

            for t in excess_transactions:
                account = db_service.get_account(t.account_id)
                if account:
                    account.balance_cents -= t.amount_cents
                db.session.delete(t)

            remaining_count = TransactionModel.query.filter(
                TransactionModel.recurring_id == recurring_id
            ).count()
            rec.idx = remaining_count + 1

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
            for t in transactions:
                account = db_service.get_account(t.account_id)
                if account:
                    account.balance -= t.amount
                db.session.delete(t)
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
                db_service.add_transaction(
                    account_id=account_id,
                    date_obj=rec.next_date,
                    vendor=rec.vendor,
                    category=rec.category,
                    amount=rec.amount,
                    notes=f"Auto-generated from recurring: {rec.notes}",
                    recurring_id=rec.id
                )

                rec.next_date = rec.advance_to_next
                transactions_created += 1

                if rec.number != -1 and rec.idx >= rec.number:
                    break

        db.session.commit()
        return transactions_created

    # UTILITY OPERATIONS ========================================================

    def recalculate_account_balance(self, account_id):
        """Audit helper to ensure balance matches sum of transaction history"""
        account = db_service.get_account(account_id)
        if account:
            total = sum(t.amount for t in account.transactions)
            account.balance = total
            db.session.commit()
            return total
        return 0