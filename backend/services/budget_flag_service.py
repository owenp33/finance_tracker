"""
budget_flag_service.py - Which expenses are over budget, computed when transactions are read

A category's monthly budget allows its amount plus any carried-over money. Walking the month's
expenses in date order (transfers don't count, and the month's reimbursements are credited up
front), every expense from the point the running total passes the allowance is over budget.
Nothing is stored, so no change to transactions or budgets can leave a flag out of date.
"""
import calendar
from collections import defaultdict
from datetime import date
from services.db_service import DbService

db_service = DbService()


def over_budget_in_month(expenses, reimbursed_cents, allocated_cents):
    """
    The ids of a category-month's expenses (given in date, then id, order) from the point the
    running total, after reimbursed_cents is credited up front, passes allocated_cents.
    """
    flagged, running = set(), -reimbursed_cents
    for t in expenses:
        running += -t.amount_cents
        if running > allocated_cents:
            flagged.add(t.id)
    return flagged


def _period(day):
    return day.strftime('%Y-%m')


def _month_bounds(period):
    year, month = int(period[:4]), int(period[5:7])
    return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])


class BudgetFlagService:

    def over_budget_ids(self, user_id, transactions):
        """
        The ids of the given transactions that are over budget. The walk counts all of the user's
        spending in each category-month involved, not just the transactions given.
        """
        months = {(t.category, _period(t.date)) for t in transactions if t.amount_cents < 0 and not t.is_transfer}
        budgets = {(b.category, b.period): b for b in db_service.get_user_budgets(user_id)}
        months = {m for m in months if m in budgets}
        if not months:
            return set()

        start = min(_month_bounds(period)[0] for _, period in months)
        end = max(_month_bounds(period)[1] for _, period in months)
        expenses, reimbursed = defaultdict(list), defaultdict(int)
        for t in db_service.get_budget_activity(user_id, {category for category, _ in months}, start, end):
            month = (t.category, _period(t.date))
            if month not in months:
                continue
            if t.amount_cents < 0:
                expenses[month].append(t)
            else:
                reimbursed[month] += t.amount_cents

        flagged = set()
        for month in months:
            budget = budgets[month]
            in_order = sorted(expenses[month], key=lambda t: (t.date, t.id))
            flagged |= over_budget_in_month(in_order, reimbursed[month], budget.amount_cents + budget.carried_over_cents)
        return flagged & {t.id for t in transactions}

    def transaction_dicts(self, user_id, transactions):
        """Transactions as the API returns them: to_dict() with over_budget computed."""
        flagged = self.over_budget_ids(user_id, transactions)
        return [{**t.to_dict(), 'over_budget': t.id in flagged} for t in transactions]
