"""
budget_service.py - Budget Business Logic

Owns all budget mutations (create / update / delete) and the progress
calculation. Raw reads (get_budget, get_user_budgets) stay in db_service.
"""
from datetime import date
from extensions import db
from models.budget import BudgetModel
from models.scheduled_pace import ScheduledPaceModel
from models.account import AccountModel
from models.transaction import TransactionModel
from services.db_service import DbService

db_service = DbService()


class BudgetService:

    def get_budget_progress(self, user_id: int, period: str) -> list:
        """
        Return spent-vs-allocated for every budget category in a period.

        period: "YYYY-MM" string
        Spending is the absolute sum of negative transactions (expenses)
        across all of the user's accounts for the given calendar month,
        matching the sign convention used throughout analytics_service.py.
        Each row also says whether its category has a scheduled pace.
        """
        budgets = BudgetModel.query.filter_by(user_id=user_id, period=period).all()
        if not budgets:
            return []

        year, month = int(period[:4]), int(period[5:7])
        if month == 12:
            next_year, next_month = year + 1, 1
        else:
            next_year, next_month = year, month + 1

        period_start = date(year, month, 1)
        period_end   = date(next_year, next_month, 1)

        # Fetch all expense rows for this user in the period in one query
        expense_rows = (
            TransactionModel.query
            .join(AccountModel, TransactionModel.account_id == AccountModel.id)
            .filter(
                AccountModel.user_id == user_id,
                TransactionModel.date >= period_start,
                TransactionModel.date <  period_end,
                TransactionModel.amount_cents < 0,      # expenses only
                TransactionModel.is_transfer == False,  # exclude inter-account transfers
            )
            .all()
        )

        # Fetch reimbursements — positive transactions marked as reimbursements
        reimbursement_rows = (
            TransactionModel.query
            .join(AccountModel, TransactionModel.account_id == AccountModel.id)
            .filter(
                AccountModel.user_id == user_id,
                TransactionModel.date >= period_start,
                TransactionModel.date <  period_end,
                TransactionModel.is_reimbursement == True,
                TransactionModel.amount_cents > 0,
            )
            .all()
        )

        # Sum absolute spending per category (in cents), then subtract reimbursements
        spending: dict[str, int] = {}
        for t in expense_rows:
            spending[t.category] = spending.get(t.category, 0) + abs(t.amount_cents)
        for t in reimbursement_rows:
            spending[t.category] = max(0, spending.get(t.category, 0) - t.amount_cents)

        scheduled = db_service.get_scheduled_pace_categories(user_id)

        result = []
        for budget in budgets:
            spent_cents           = spending.get(budget.category, 0)
            total_allocated_cents = budget.amount_cents + budget.carried_over_cents
            remaining_cents       = total_allocated_cents - spent_cents

            result.append({
                'id':                   budget.id,
                'category':             budget.category,
                'period':               budget.period,
                'allocated':            budget.amount,
                'allocated_cents':      budget.amount_cents,
                'carried_over':         budget.carried_over,
                'carried_over_cents':   budget.carried_over_cents,
                'spent':                round(spent_cents / 100.0, 2),
                'spent_cents':          spent_cents,
                'remaining':            round(remaining_cents / 100.0, 2),
                'remaining_cents':      remaining_cents,
                'rollover':             budget.rollover,
                'over_budget':          remaining_cents < 0,
                'scheduled_pace':       budget.category in scheduled,
            })

        result.sort(key=lambda x: x['category'])
        return result

    # MUTATIONS =================================================================

    def create_budget(self, user_id, category, period, amount, rollover=False, carried_over=0.0):
        """Create a budget allocation. (Over-budget flags are computed when transactions are read.)"""
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

    def update_budget(self, budget_id, data):
        """
        Apply field updates to a budget allocation.
        Returns (updated_budget, error_message).
        """
        budget = db_service.get_budget(budget_id)
        if not budget:
            return None, 'Budget not found'

        if 'amount' in data:
            budget.amount = float(data['amount'])
        if 'rollover' in data:
            budget.rollover = bool(data['rollover'])
        if 'carried_over' in data:
            budget.carried_over = float(data['carried_over'])
        if 'category' in data:
            budget.category = data['category']

        db.session.commit()
        return budget, None

    def delete_budget(self, budget_id):
        """
        Remove a budget allocation and any future rollover copies of it.
        """
        budget = db_service.get_budget(budget_id)
        if not budget:
            return False

        user_id  = budget.user_id
        category = budget.category
        period   = budget.period

        # Collect the target budget plus all future rollover copies for this category
        future_rollover = BudgetModel.query.filter(
            BudgetModel.user_id  == user_id,
            BudgetModel.category == category,
            BudgetModel.period   >  period,
            BudgetModel.rollover == True,
        ).all()
        to_delete = [budget] + future_rollover

        for b in to_delete:
            db.session.delete(b)

        db.session.commit()
        return True

    # SCHEDULED PACE ============================================================

    def set_scheduled_pace(self, user_id, category, scheduled):
        """
        Pace a budget category by its recurring charges (scheduled=True) or evenly (False), in
        every month. The category matches exactly, as its budgets name it, and the setting stays
        when its budgets are deleted. Raises ValueError unless the category is text of 1 to 50
        characters and `scheduled` is a boolean. Setting the pace a category already has changes
        nothing.
        """
        if not isinstance(category, str):
            raise ValueError("'category' must be text.")
        if not category.strip():
            raise ValueError("'category' can't be empty.")
        limit = ScheduledPaceModel.category.type.length
        if len(category) > limit:
            raise ValueError(f"'category' must be at most {limit} characters.")
        if not isinstance(scheduled, bool):
            raise ValueError("'scheduled' must be true or false.")

        user_id = int(user_id)   # the JWT identity is a string; the session's keys hold ints
        setting = db_service.get_scheduled_pace(user_id, category)
        if scheduled and setting is None:
            db.session.add(ScheduledPaceModel(user_id=user_id, category=category))
        elif not scheduled and setting is not None:
            db.session.delete(setting)
        db.session.commit()
