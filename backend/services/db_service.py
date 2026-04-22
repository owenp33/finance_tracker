"""
db_service.py - Data Access Layer

Thin CRUD operations for interacting with the database.
Business logic and orchestration belongs in account_service.py.
"""
from extensions import db
from models.user import User
from models.account import AccountModel
from models.transaction import TransactionModel
from models.recurring import RecurringModel


class DbService:

    def create_tables(self):
        db.create_all()

    # USER OPERATIONS ===========================================================

    def create_user(self, username, email, password):
        user = User(username=username, email=email)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        return user

    def authenticate_user(self, username, password):
        user = User.query.filter_by(username=username).first()
        if user and user.verify_password(password):
            return user
        return None

    def get_user_by_id(self, user_id):
        return User.query.get(user_id)

    # ACCOUNT OPERATIONS ========================================================

    def create_account(self, user_id, acct_id_str, account_name=""):
        display_name = account_name if account_name else acct_id_str
        acc = AccountModel(
            user_id=user_id,
            acct_id_str=acct_id_str,
            acct_name=display_name,
            balance_cents=0
        )
        db.session.add(acc)
        db.session.commit()
        return acc

    def get_user_accounts(self, user_id):
        return AccountModel.query.filter_by(user_id=user_id).all()

    def get_account(self, account_id):
        return AccountModel.query.get(account_id)

    # TRANSACTION OPERATIONS ====================================================

    def add_transaction(self, account_id, date_obj, vendor, category, amount, notes="", recurring_id=None):
        transaction = TransactionModel(
            account_id=account_id,
            date=date_obj,
            vendor=vendor,
            category=category,
            notes=notes,
            recurring_id=recurring_id
        )
        transaction.amount = amount

        account = self.get_account(account_id)
        if account:
            account.balance_cents += transaction.amount_cents
        db.session.add(transaction)
        db.session.flush()   # assign transaction.id before evaluating the flag

        if transaction.amount_cents < 0:
            transaction.over_budget = self._evaluate_over_budget(
                user_id=account.user_id,
                category=category,
                period=date_obj.strftime('%Y-%m'),
                pending_cents=transaction.amount_cents,
            )

        db.session.commit()
        return transaction

    def _evaluate_over_budget(self, user_id, category, period, pending_cents):
        """
        Return True if adding pending_cents (a negative expense value) causes
        total spending in this category/period to exceed the budget allocation.
        Returns False when no budget exists for the category (no allocation = no flag).
        """
        from models.budget import BudgetModel

        budget = BudgetModel.query.filter_by(
            user_id=user_id,
            category=category,
            period=period,
        ).first()

        if not budget:
            return False

        # Sum all existing expenses for this category/period across all user accounts
        from datetime import date
        year, month = int(period[:4]), int(period[5:7])
        next_year, next_month = (year + 1, 1) if month == 12 else (year, month + 1)
        period_start = date(year, month, 1)
        period_end   = date(next_year, next_month, 1)

        from models.account import AccountModel
        existing_cents = db.session.query(
            db.func.coalesce(db.func.sum(TransactionModel.amount_cents), 0)
        ).join(
            AccountModel, TransactionModel.account_id == AccountModel.id
        ).filter(
            AccountModel.user_id == user_id,
            TransactionModel.category == category,
            TransactionModel.date >= period_start,
            TransactionModel.date <  period_end,
            TransactionModel.amount_cents < 0,
        ).scalar()

        total_allocated_cents = budget.amount_cents + budget.carried_over_cents
        # pending_cents is negative; adding it increases total spending
        total_spent_cents = abs(existing_cents) + abs(pending_cents)
        return total_spent_cents > total_allocated_cents

    def get_transaction(self, transaction_id):
        return TransactionModel.query.get(transaction_id)

    def transaction_exists(self, account_id, date_obj, vendor, amount_cents):
        return TransactionModel.query.filter_by(
            account_id=account_id,
            date=date_obj,
            vendor=vendor,
            amount_cents=amount_cents
        ).first() is not None

    def get_account_transactions(self, account_id, start_date=None, end_date=None,
                                  category=None, over_budget=None, limit=None, offset=None):
        """
        Fetch transactions for an account with optional filters.

        start_date / end_date : datetime.date  — inclusive on both ends
        category              : str            — exact match
        over_budget           : bool           — filter to flagged rows only
        limit / offset        : int            — pagination
        """
        query = TransactionModel.query.filter_by(account_id=account_id)

        if start_date is not None:
            query = query.filter(TransactionModel.date >= start_date)
        if end_date is not None:
            query = query.filter(TransactionModel.date <= end_date)
        if category is not None:
            query = query.filter(TransactionModel.category == category)
        if over_budget is not None:
            query = query.filter(TransactionModel.over_budget == over_budget)

        query = query.order_by(TransactionModel.date.desc())

        if offset is not None:
            query = query.offset(offset)
        if limit is not None:
            query = query.limit(limit)

        return query.all()

    def get_all_user_transactions(self, user_id):
        return (TransactionModel.query
                .join(AccountModel)
                .filter(AccountModel.user_id == user_id)
                .order_by(TransactionModel.date.desc())
                .all())

    # RECURRING OPERATIONS ======================================================

    def add_recurring(self, account_id, start_date, vendor, category, amount, next_date, frequency, number=-1, notes=""):
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
            idx=1
        )
        db.session.add(rec)
        db.session.commit()
        return rec

    def get_recurring(self, recurring_id):
        return RecurringModel.query.get(recurring_id)

    def get_account_recurring(self, account_id):
        return RecurringModel.query.filter_by(account_id=account_id).all()

    # BUDGET OPERATIONS =========================================================

    def get_user_budgets(self, user_id, period=None):
        from models.budget import BudgetModel
        query = BudgetModel.query.filter_by(user_id=user_id)
        if period:
            query = query.filter_by(period=period)
        return query.order_by(BudgetModel.category).all()

    def get_budget(self, budget_id):
        from models.budget import BudgetModel
        return BudgetModel.query.get(budget_id)

    def create_budget(self, user_id, category, period, amount, rollover=False, carried_over=0.0):
        from models.budget import BudgetModel
        budget = BudgetModel(
            user_id=user_id,
            category=category,
            period=period,
            amount_cents=int(round(amount * 100)),
            rollover=rollover,
            carried_over_cents=int(round(carried_over * 100)),
        )
        db.session.add(budget)
        db.session.commit()
        return budget

    def delete_budget(self, budget_id):
        budget = self.get_budget(budget_id)
        if budget:
            db.session.delete(budget)
            db.session.commit()
            return True
        return False