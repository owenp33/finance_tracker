"""
account_service.py - Account & Transaction Business Logic

Orchestrates business rules around accounts, transactions, and recurring items.
Depends on db_service.py for raw data access.
"""
from datetime import date, timedelta
from app import db
from models.transaction import TransactionModel
from models.recurring import RecurringModel
from services.db_service import DbService

db_service = DbService()


class AccountService:

    # TRANSACTION OPERATIONS ====================================================

    def update_transaction(self, transaction_id, **kwargs):
        """Update transaction fields and adjust account balance if amount changed"""
        trans = db_service.get_transaction(transaction_id)
        if not trans:
            return False

        old_amount = trans.amount

        for key, value in kwargs.items():
            if hasattr(trans, key) and key != 'id':
                setattr(trans, key, value)

        if 'amount' in kwargs and kwargs['amount'] != old_amount:
            account = db_service.get_account(trans.account_id)
            if account:
                account.balance += (kwargs['amount'] - old_amount)

        db.session.commit()
        return trans

    def delete_transaction(self, transaction_id):
        """Delete a transaction and adjust account balance"""
        t = db_service.get_transaction(transaction_id)
        if not t:
            return False

        account = db_service.get_account(t.account_id)
        if account:
            account.balance -= t.amount

        db.session.delete(t)
        db.session.commit()
        return True

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
                    account.balance -= t.amount
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

    def get_bank_account(self, account_id):
        """
        Convert AccountModel to BankAccount object for compatibility with legacy code.
        Bridges the database layer with the legacy business logic layer.
        """
        from accounts import BankAccount

        account_model = db_service.get_account(account_id)
        if not account_model:
            return None

        acct_dict = {
            'acctId': account_model.acct_id_str,
            'balance': account_model.balance,
            'transactions': {},
            'recurring': {}
        }

        for trans in account_model.transactions:
            key = f"single_{trans.vendor}_{trans.date.isoformat()}"
            acct_dict['transactions'][key] = {
                'date': trans.date.isoformat(),
                'vendor': trans.vendor,
                'category': trans.category,
                'amount': trans.amount,
                'notes': trans.notes
            }

        for rec in account_model.recurring:
            key = f"recurs_{rec.vendor}_{rec.start_date.isoformat()}"
            acct_dict['recurring'][key] = {
                'start': rec.start_date.isoformat(),
                'vendor': rec.vendor,
                'category': rec.category,
                'amount': rec.amount,
                'notes': rec.notes,
                'next': rec.next_date.isoformat(),
                'frequency': rec.frequency,
                'number': rec.number
            }

        return BankAccount(acctInfo=acct_dict, acctId=account_model.acct_id_str)