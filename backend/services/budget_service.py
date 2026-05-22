"""
budget_service.py - Budget Business Logic

Owns all budget mutations (create / update / delete) and the progress
calculation. Raw reads (get_budget, get_user_budgets) stay in db_service.
"""
from datetime import date
from extensions import db
from models.budget import BudgetModel
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

    # MUTATIONS =================================================================

    def create_budget(self, user_id, category, period, amount, rollover=False, carried_over=0.0):
        """
        Create a budget allocation and immediately re-evaluate flags for the
        category/period — existing spending may already exceed the new limit.
        """
        budget = BudgetModel(
            user_id=user_id,
            category=category,
            period=period,
            amount_cents=int(round(amount * 100)),
            rollover=rollover,
            carried_over_cents=int(round(carried_over * 100)),
        )
        db.session.add(budget)
        db.session.flush()
        db_service._reevaluate_category_flags(user_id, category, period)
        db.session.commit()
        return budget

    def update_budget(self, budget_id, data):
        """
        Apply field updates to a budget allocation and re-evaluate flags when
        the threshold changes (amount, carried_over) or category is renamed.
        Returns (updated_budget, error_message).
        """
        budget = db_service.get_budget(budget_id)
        if not budget:
            return None, 'Budget not found'

        old_category = budget.category
        needs_reevaluation = False

        if 'amount' in data:
            budget.amount = float(data['amount'])
            needs_reevaluation = True
        if 'rollover' in data:
            budget.rollover = bool(data['rollover'])
        if 'carried_over' in data:
            budget.carried_over = float(data['carried_over'])
            needs_reevaluation = True
        if 'category' in data:
            budget.category = data['category']
            needs_reevaluation = True

        if needs_reevaluation:
            db.session.flush()
            # If category was renamed, clear flags on the old name too
            if budget.category != old_category:
                db_service._reevaluate_category_flags(budget.user_id, old_category, budget.period)
            db_service._reevaluate_category_flags(budget.user_id, budget.category, budget.period)

        db.session.commit()
        return budget, None

    def delete_budget(self, budget_id):
        """
        Remove a budget allocation and any future rollover copies of it, then
        clear over_budget flags on transactions for every affected period.
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
            b_year, b_month = int(b.period[:4]), int(b.period[5:7])
            b_next_year, b_next_month = (b_year + 1, 1) if b_month == 12 else (b_year, b_month + 1)
            period_start = date(b_year,      b_month,      1)
            period_end   = date(b_next_year, b_next_month, 1)

            # SELECT ids first — .update() cannot be used with .join()
            tx_ids = [
                t.id for t in (
                    TransactionModel.query
                    .join(AccountModel, TransactionModel.account_id == AccountModel.id)
                    .filter(
                        AccountModel.user_id        == user_id,
                        TransactionModel.category   == category,
                        TransactionModel.date       >= period_start,
                        TransactionModel.date       <  period_end,
                    )
                    .all()
                )
            ]
            if tx_ids:
                TransactionModel.query.filter(
                    TransactionModel.id.in_(tx_ids)
                ).update({'over_budget': False}, synchronize_session='fetch')

            db.session.delete(b)

        db.session.commit()
        return True
