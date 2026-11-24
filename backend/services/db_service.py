"""
db_service.py - Data Access Layer

Thin CRUD operations for interacting with the database.
Business logic and orchestration belongs in account_service.py.
"""
from datetime import timedelta
from sqlalchemy import case, func, or_, select, update
from extensions import db
from models.user import User
from models.account import AccountModel
from models.transaction import TransactionModel
from models.interest_hit import InterestHitModel
from models.recurring import RecurringModel
from models.recurring_dismissal import RecurringDismissalModel
from models.recurring_alias import RecurringAliasModel
from models.series_dismissal import SeriesDismissalModel
from models.scheduled_pace import ScheduledPaceModel


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
        return db.session.get(User, user_id)

    # ACCOUNT OPERATIONS ========================================================

    def create_account(self, user_id, acct_id_str, account_name="", needs_attention=False, kind='bank', apr_bps=None,
                       interest_frequency=None, interest_through=None):
        display_name = account_name if account_name else acct_id_str
        acc = AccountModel(
            user_id=user_id,
            acct_id_str=acct_id_str,
            acct_name=display_name,
            balance_cents=0,
            needs_attention=needs_attention,
            kind=kind,
            apr_bps=apr_bps,
            interest_frequency=interest_frequency,
            interest_through=interest_through,
        )
        db.session.add(acc)
        db.session.commit()
        return acc

    def get_user_accounts(self, user_id):
        return AccountModel.query.filter_by(user_id=user_id).all()

    def get_account(self, account_id):
        return db.session.get(AccountModel, account_id)

    # Stored balances change only through these three, each a single SQL statement: reading the
    # balance into Python, adding, and writing it back lets two simultaneous requests overwrite
    # each other's change.

    def adjust_balance(self, account_id, delta_cents):
        """Add delta_cents to an account's stored balance atomically."""
        if delta_cents:
            self._update_balance(account_id, balance_cents=AccountModel.balance_cents + delta_cents)

    def recompute_balance(self, account_id):
        """
        Set an account's stored balance to its starting balance plus what moves it (its
        transactions, its interest and a loan's payments: see _transaction_total), atomically.
        """
        self._update_balance(account_id, balance_cents=AccountModel.opening_balance_cents + self._transaction_total(account_id))

    def set_balance(self, account_id, balance_cents):
        """
        Set an account's stored balance to balance_cents and its starting balance to that less what
        moves it (see _transaction_total), atomically, so starting balance + that = balance.
        """
        self._update_balance(account_id, balance_cents=balance_cents,
                             opening_balance_cents=balance_cents - self._transaction_total(account_id))

    def _transaction_total(self, account_id):
        """
        What moves an account's balance, as a subquery for the statements above: the sum of its
        transactions and its interest hits, less the payments of the series that pay it down (a
        loan's: a $75 bill paid from Checking is $75 less owed).
        """
        own = (select(func.coalesce(func.sum(TransactionModel.amount_cents), 0))
               .where(TransactionModel.account_id == account_id)
               .scalar_subquery())
        interest = (select(func.coalesce(func.sum(InterestHitModel.amount_cents), 0))
                    .where(InterestHitModel.account_id == account_id)
                    .scalar_subquery())
        paid = (select(func.coalesce(func.sum(TransactionModel.amount_cents), 0))
                .select_from(TransactionModel)
                .join(RecurringModel, TransactionModel.recurring_id == RecurringModel.id)
                .where(RecurringModel.loan_account_id == account_id)
                .scalar_subquery())
        return own + interest - paid

    def _update_balance(self, account_id, **values):
        db.session.flush()   # write pending changes first (a starting balance, a new transaction)
        db.session.execute(
            update(AccountModel)
            .where(AccountModel.id == account_id)
            .values(**values)
            .execution_options(synchronize_session=False)
        )
        # A loaded account still holds the old values; make it read the new ones when next used
        account = db.session.get(AccountModel, account_id)
        if account:
            db.session.expire(account, list(values))

    # TRANSACTION OPERATIONS ====================================================

    def get_transaction(self, transaction_id):
        return db.session.get(TransactionModel, transaction_id)

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

    def get_series_transactions(self, account_ids, start_date, end_date):
        """Transactions in a recurring series on these accounts, dated between the dates (inclusive)."""
        return TransactionModel.query.filter(
            TransactionModel.account_id.in_(account_ids),
            TransactionModel.recurring_id.isnot(None),
            TransactionModel.date.between(start_date, end_date),
        ).all()

    def get_account_transactions(self, account_id, start_date=None, end_date=None,
                                  category=None, limit=None, offset=None):
        """
        Fetch transactions for an account with optional filters.

        start_date / end_date : datetime.date  — inclusive on both ends
        category              : str            — exact match
        limit / offset        : int            — pagination
        """
        query = TransactionModel.query.filter_by(account_id=account_id)

        if start_date is not None:
            query = query.filter(TransactionModel.date >= start_date)
        if end_date is not None:
            query = query.filter(TransactionModel.date <= end_date)
        if category is not None:
            query = query.filter(TransactionModel.category == category)

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
        Used by BalanceService (the exports' ledgers). All filters are optional.
        """
        query = TransactionModel.query.join(AccountModel).filter(AccountModel.user_id == user_id)

        if account_ids:
            query = query.filter(TransactionModel.account_id.in_(account_ids))
        if start_date is not None:
            query = query.filter(TransactionModel.date >= start_date)
        if end_date is not None:
            query = query.filter(TransactionModel.date <= end_date)

        return query.order_by(TransactionModel.date.asc()).all()

    def get_budget_activity(self, user_id, categories, start_date, end_date):
        """
        The user's transactions that count toward budgets in these categories between the dates
        (inclusive): expenses that aren't transfers, and reimbursements, neither on a loan account.
        """
        return (
            TransactionModel.query
            .join(AccountModel, TransactionModel.account_id == AccountModel.id)
            .filter(
                AccountModel.user_id == user_id,
                AccountModel.kind != 'loan',
                TransactionModel.category.in_(categories),
                TransactionModel.date.between(start_date, end_date),
                or_(
                    (TransactionModel.amount_cents < 0) & TransactionModel.is_transfer.is_(False),
                    (TransactionModel.amount_cents > 0) & TransactionModel.is_reimbursement.is_(True),
                ),
            )
            .all()
        )

    def get_category_totals(self, user_id, category):
        """
        The user's transactions in one category, over all time: `money_in` and `money_out` (cents,
        both positive) and how many (`counted`) of those that count in totals (not transfers, not on
        a loan account), and how many it has in all (`total`).
        """
        counted = TransactionModel.is_transfer.is_(False) & (AccountModel.kind != 'loan')
        money_in, money_out, counted_count, total = (
            db.session.query(
                func.coalesce(func.sum(case((counted & (TransactionModel.amount_cents > 0), TransactionModel.amount_cents),
                                            else_=0)), 0),
                func.coalesce(func.sum(case((counted & (TransactionModel.amount_cents < 0), -TransactionModel.amount_cents),
                                            else_=0)), 0),
                func.coalesce(func.sum(case((counted, 1), else_=0)), 0),
                func.count(TransactionModel.id),
            )
            .join(AccountModel, TransactionModel.account_id == AccountModel.id)
            .filter(AccountModel.user_id == user_id, TransactionModel.category == category)
            .one()
        )
        return {'money_in': int(money_in), 'money_out': int(money_out), 'counted': int(counted_count), 'total': total}

    def get_transaction_totals_before(self, account_ids, before_date):
        """
        What moved each account's balance before before_date, {account_id: cents}: its transactions
        and interest hits dated before it, less the payments dated before it of the series that pay
        it down (a loan's).
        """
        rows = (
            db.session.query(TransactionModel.account_id, func.sum(TransactionModel.amount_cents))
            .filter(TransactionModel.account_id.in_(account_ids), TransactionModel.date < before_date)
            .group_by(TransactionModel.account_id)
            .all()
        )
        totals = {account_id: int(total) for account_id, total in rows}
        interest = (
            db.session.query(InterestHitModel.account_id, func.sum(InterestHitModel.amount_cents))
            .filter(InterestHitModel.account_id.in_(account_ids), InterestHitModel.date < before_date)
            .group_by(InterestHitModel.account_id)
            .all()
        )
        for account_id, total in interest:
            totals[account_id] = totals.get(account_id, 0) + int(total)
        paid = (
            db.session.query(RecurringModel.loan_account_id, func.sum(TransactionModel.amount_cents))
            .join(RecurringModel, TransactionModel.recurring_id == RecurringModel.id)
            .filter(RecurringModel.loan_account_id.in_(account_ids), TransactionModel.date < before_date)
            .group_by(RecurringModel.loan_account_id)
            .all()
        )
        for loan_id, total in paid:
            totals[loan_id] = totals.get(loan_id, 0) - int(total)
        return totals

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
        return db.session.get(RecurringModel, recurring_id)

    def get_dismissal(self, recurring_id, transaction_id):
        return db.session.get(RecurringDismissalModel, (recurring_id, transaction_id))

    def get_dismissed_transaction_ids(self, recurring_id):
        return {d.transaction_id for d in RecurringDismissalModel.query.filter_by(recurring_id=recurring_id)}

    def get_alias(self, recurring_id, alias):
        return db.session.get(RecurringAliasModel, (recurring_id, alias))

    def get_series_dismissal(self, account_id, vendor_key, amount_cents):
        return db.session.get(SeriesDismissalModel, (account_id, vendor_key, amount_cents))

    def get_series_dismissals(self, user_id):
        """The user's "Not recurring" marks as (account_id, vendor_key, amount_cents)."""
        rows = (SeriesDismissalModel.query.join(AccountModel)
                .filter(AccountModel.user_id == user_id).all())
        return [(d.account_id, d.vendor_key, d.amount_cents) for d in rows]

    def get_all_accounts(self):
        """Return every account across all users (used by the background scheduler)."""
        return AccountModel.query.all()

    def get_account_recurring(self, account_id):
        return RecurringModel.query.filter_by(account_id=account_id).all()

    def get_user_recurring(self, user_id):
        return (RecurringModel.query
                .join(AccountModel, RecurringModel.account_id == AccountModel.id)
                .filter(AccountModel.user_id == user_id)
                .all())

    # GOAL OPERATIONS ===========================================================

    def get_goal(self, goal_id):
        from models.goal import GoalModel
        return db.session.get(GoalModel, goal_id)

    def get_user_goals(self, user_id):
        """The user's goals in their order."""
        from models.goal import GoalModel
        return GoalModel.query.filter_by(user_id=int(user_id)).order_by(GoalModel.position, GoalModel.id).all()

    # LOAN OPERATIONS ===========================================================

    def get_series_paying_down(self, loan_account_id):
        """The templates whose series pay down this loan account."""
        return RecurringModel.query.filter_by(loan_account_id=loan_account_id).all()

    def get_loan_payments(self, loan_account_ids, start_date=None, end_date=None):
        """
        The payments that pay down these loan accounts, as (loan account id, transaction): the
        non-zero transactions of the series paying each one down, dated start_date through
        end_date (both inclusive, both optional).
        """
        query = (db.session.query(RecurringModel.loan_account_id, TransactionModel)
                 .join(RecurringModel, TransactionModel.recurring_id == RecurringModel.id)
                 .filter(RecurringModel.loan_account_id.in_(loan_account_ids), TransactionModel.amount_cents != 0))
        if start_date is not None:
            query = query.filter(TransactionModel.date >= start_date)
        if end_date is not None:
            query = query.filter(TransactionModel.date <= end_date)
        return query.all()

    # INTEREST OPERATIONS =======================================================

    def get_interest_hit(self, hit_id):
        return db.session.get(InterestHitModel, hit_id)

    def get_user_interest_hits(self, user_id):
        """The user's interest hits, newest first."""
        return (InterestHitModel.query.join(AccountModel)
                .filter(AccountModel.user_id == int(user_id))
                .order_by(InterestHitModel.date.desc(), InterestHitModel.id.desc())
                .all())

    def get_interest_hits(self, account_ids, start_date=None, end_date=None):
        """These accounts' interest hits dated start_date through end_date (both inclusive, both optional)."""
        query = InterestHitModel.query.filter(InterestHitModel.account_id.in_(account_ids))
        if start_date is not None:
            query = query.filter(InterestHitModel.date >= start_date)
        if end_date is not None:
            query = query.filter(InterestHitModel.date <= end_date)
        return query.all()

    def claim_interest_period(self, account_id, booked_through, start):
        """
        Move an account's interest_through from `booked_through` to `start` in one statement, and
        say whether it moved: it doesn't when another run already did, so a period is booked once.
        """
        db.session.flush()
        current = (AccountModel.interest_through.is_(None) if booked_through is None
                   else AccountModel.interest_through == booked_through)
        moved = db.session.execute(
            update(AccountModel).where(AccountModel.id == account_id, current).values(interest_through=start)
        ).rowcount == 1
        account = db.session.get(AccountModel, account_id)
        if account is not None:
            db.session.expire(account, ['interest_through'])
        return moved

    # BUDGET OPERATIONS =========================================================

    def get_user_budgets(self, user_id, period=None):
        from models.budget import BudgetModel
        query = BudgetModel.query.filter_by(user_id=user_id)
        if period:
            query = query.filter_by(period=period)
        return query.order_by(BudgetModel.category).all()

    def get_budget(self, budget_id):
        from models.budget import BudgetModel
        return db.session.get(BudgetModel, budget_id)

    def get_scheduled_pace(self, user_id, category):
        return db.session.get(ScheduledPaceModel, (user_id, category))

    def get_scheduled_pace_categories(self, user_id):
        """The budget categories the user paces by their recurring charges."""
        return {p.category for p in ScheduledPaceModel.query.filter_by(user_id=user_id)}

