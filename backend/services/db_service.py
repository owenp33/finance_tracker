"""
db_service.py - Data Access Layer

Thin CRUD operations for interacting with the database.
Business logic and orchestration belongs in account_service.py.
"""
from datetime import timedelta
from sqlalchemy import func, or_
from extensions import db
from models.user import User
from models.account import AccountModel
from models.transaction import TransactionModel
from models.recurring import RecurringModel
from models.recurring_dismissal import RecurringDismissalModel


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

    def get_user_by_username(self, username):
        return User.query.filter_by(username=username).first()

    def get_user_by_email(self, email):
        return User.query.filter_by(email=email).first()

    def get_user_by_id(self, user_id):
        return User.query.get(user_id)

    # ACCOUNT OPERATIONS ========================================================

    def create_account(self, user_id, acct_id_str, account_name="", needs_attention=False):
        display_name = account_name if account_name else acct_id_str
        acc = AccountModel(
            user_id=user_id,
            acct_id_str=acct_id_str,
            acct_name=display_name,
            balance_cents=0,
            needs_attention=needs_attention,
        )
        db.session.add(acc)
        db.session.commit()
        return acc

    def get_user_accounts(self, user_id):
        return AccountModel.query.filter_by(user_id=user_id).all()

    def get_account(self, account_id):
        return AccountModel.query.get(account_id)

    # TRANSACTION OPERATIONS ====================================================

    def _reevaluate_category_flags(self, user_id, category, period):
        """
        Recompute over_budget for every expense transaction in a category/period.

        Walks transactions chronologically (oldest first), accumulating spending.
        Flags every transaction from the point cumulative spending first exceeds
        the allocation. Clears all flags when spending is within budget.

        Does NOT commit — callers are responsible for committing the session.
        No-op when no budget allocation exists for the category.
        """
        from models.budget import BudgetModel
        from datetime import date

        budget = BudgetModel.query.filter_by(
            user_id=user_id,
            category=category,
            period=period,
        ).first()

        if not budget:
            return

        year, month = int(period[:4]), int(period[5:7])
        next_year, next_month = (year + 1, 1) if month == 12 else (year, month + 1)
        period_start = date(year, month, 1)
        period_end   = date(next_year, next_month, 1)

        transactions = (
            TransactionModel.query
            .join(AccountModel, TransactionModel.account_id == AccountModel.id)
            .filter(
                AccountModel.user_id == user_id,
                TransactionModel.category == category,
                TransactionModel.date >= period_start,
                TransactionModel.date <  period_end,
                TransactionModel.amount_cents < 0,
                TransactionModel.is_transfer == False,  # exclude inter-account transfers
            )
            .order_by(TransactionModel.date.asc(), TransactionModel.id.asc())
            .all()
        )

        # Sum positive reimbursements for the category — they offset spending
        from sqlalchemy import func as sa_func
        reimbursement_cents = (
            db.session.query(sa_func.sum(TransactionModel.amount_cents))
            .join(AccountModel, TransactionModel.account_id == AccountModel.id)
            .filter(
                AccountModel.user_id == user_id,
                TransactionModel.category == category,
                TransactionModel.date >= period_start,
                TransactionModel.date <  period_end,
                TransactionModel.is_reimbursement == True,
                TransactionModel.amount_cents > 0,
            )
            .scalar() or 0
        )

        allocated_cents = budget.amount_cents + budget.carried_over_cents
        # Start negative so reimbursements act as a pre-credit against spending
        cumulative = -reimbursement_cents
        for t in transactions:
            cumulative += abs(t.amount_cents)
            t.over_budget = cumulative > allocated_cents

    def get_transaction(self, transaction_id):
        return TransactionModel.query.get(transaction_id)

    def transaction_exists(self, account_id, date_obj, vendor, amount_cents):
        from sqlalchemy import func as sa_func
        return TransactionModel.query.filter(
            TransactionModel.account_id == account_id,
            TransactionModel.date == date_obj,
            sa_func.lower(sa_func.trim(TransactionModel.vendor)) == vendor.strip().lower(),
            TransactionModel.amount_cents == amount_cents,
        ).first() is not None

    def find_recurring_candidates(self, account_id, vendor, amount_cents, around, window_days):
        """
        Transactions in no recurring series on an account with this vendor (case and surrounding
        spaces ignored) and amount, dated within ±window_days of `around`. Nearest date first.
        """
        window = timedelta(days=window_days)
        rows = TransactionModel.query.filter(
            TransactionModel.account_id == account_id,
            TransactionModel.recurring_id.is_(None),
            func.lower(func.trim(TransactionModel.vendor)) == vendor.strip().lower(),
            TransactionModel.amount_cents == amount_cents,
            TransactionModel.date.between(around - window, around + window),
        ).all()
        return sorted(rows, key=lambda t: (abs((t.date - around).days), t.id))

    def find_unlinked_transactions(self, account_id, vendor, category, amount_cents, after, until):
        """
        Transactions in no recurring series on an account with this vendor, moving money the same
        way as amount_cents, and either this category (any amount) or exactly this amount (any
        category), dated after `after` and up to `until`. Text compares ignore case and
        surrounding spaces.
        """
        same_direction = TransactionModel.amount_cents < 0 if amount_cents < 0 else TransactionModel.amount_cents > 0
        return TransactionModel.query.filter(
            TransactionModel.account_id == account_id,
            TransactionModel.recurring_id.is_(None),
            func.lower(func.trim(TransactionModel.vendor)) == vendor.strip().lower(),
            same_direction,
            or_(
                func.lower(func.trim(TransactionModel.category)) == category.strip().lower(),
                TransactionModel.amount_cents == amount_cents,
            ),
            TransactionModel.date > after,
            TransactionModel.date <= until,
        ).all()

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

    def get_user_transactions_filtered(self, user_id, account_ids=None, start_date=None, end_date=None):
        """
        Fetch a user's transactions scoped to specific accounts and/or a date range.
        Used by the CSV/PDF export endpoints. All filters are optional.
        """
        query = TransactionModel.query.join(AccountModel).filter(AccountModel.user_id == user_id)

        if account_ids:
            query = query.filter(TransactionModel.account_id.in_(account_ids))
        if start_date is not None:
            query = query.filter(TransactionModel.date >= start_date)
        if end_date is not None:
            query = query.filter(TransactionModel.date <= end_date)

        return query.order_by(TransactionModel.date.asc()).all()

    def get_transaction_totals_before(self, account_ids, before_date):
        """The sum of amount_cents per account for transactions dated before before_date: {account_id: cents}."""
        rows = (
            db.session.query(TransactionModel.account_id, func.sum(TransactionModel.amount_cents))
            .filter(TransactionModel.account_id.in_(account_ids), TransactionModel.date < before_date)
            .group_by(TransactionModel.account_id)
            .all()
        )
        return {account_id: int(total) for account_id, total in rows}

    def find_transfer_peer(self, user_id, amount_cents, date_obj, exclude_account_id, exclude_id=None):
        """
        Find an unlinked transfer transaction that is the counterpart to a given one.

        Matches on: opposite-sign amount, same user, different account,
        within ±5 days, already flagged as a transfer, not yet linked.
        Returns the closest match by date, or None.
        """
        from datetime import timedelta
        date_min = date_obj - timedelta(days=5)
        date_max = date_obj + timedelta(days=5)

        query = (
            TransactionModel.query
            .join(AccountModel, TransactionModel.account_id == AccountModel.id)
            .filter(
                AccountModel.user_id == user_id,
                TransactionModel.amount_cents == -amount_cents,
                TransactionModel.date >= date_min,
                TransactionModel.date <= date_max,
                TransactionModel.account_id != exclude_account_id,
                TransactionModel.is_transfer == True,
                TransactionModel.transfer_peer_id == None,
            )
        )
        if exclude_id is not None:
            query = query.filter(TransactionModel.id != exclude_id)

        return query.order_by(TransactionModel.date.asc()).first()

    # RECURRING OPERATIONS ======================================================

    def get_recurring(self, recurring_id):
        return RecurringModel.query.get(recurring_id)

    def get_dismissal(self, recurring_id, transaction_id):
        return db.session.get(RecurringDismissalModel, (recurring_id, transaction_id))

    def get_dismissed_transaction_ids(self, recurring_id):
        return {d.transaction_id for d in RecurringDismissalModel.query.filter_by(recurring_id=recurring_id)}

    def get_all_accounts(self):
        """Return every account across all users (used by the background scheduler)."""
        return AccountModel.query.all()

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

