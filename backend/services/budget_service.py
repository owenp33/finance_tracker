"""
budget_service.py - Budget Business Logic

Progress calculation: joins budget allocations against actual transaction
spending for a given period. All other budget mutations (create/update/delete)
go through db_service to stay consistent with the rest of the codebase.
"""
from datetime import date
from models.budget import BudgetModel
from models.account import AccountModel
from models.transaction import TransactionModel


class BudgetService:

    def get_budget_progress(self, user_id: int, period: str) -> list:
        """
        Return spent-vs-allocated for every budget category in a period.

        period: "YYYY-MM" string
        Spending is the absolute sum of negative transactions (expenses)
        across all of the user's accounts for the given calendar month,
        matching the sign convention used throughout analytics_service.py.
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
            )
            .all()
        )

        # Sum absolute spending per category (in cents)
        spending: dict[str, int] = {}
        for t in expense_rows:
            spending[t.category] = spending.get(t.category, 0) + abs(t.amount_cents)

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
            })

        result.sort(key=lambda x: x['category'])
        return result
