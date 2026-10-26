"""
Budget flag tests: which expenses are over budget, computed when transactions are read
(nothing stored, so no change can leave a flag stale).
"""
from datetime import date

import pytest

from extensions import db as _db
from models.account import AccountModel
from services.account_service import AccountService
from services.budget_flag_service import BudgetFlagService, over_budget_in_month
from services.budget_service import BudgetService

account_svc = AccountService()
budgets = BudgetService()
flags = BudgetFlagService()


def _expense(account, day, amount, category='Groceries', **kwargs):
    return account_svc.add_transaction(account.id, day, 'Shop', category, amount, **kwargs)


def _flagged(user, transactions):
    return {t.id for t in transactions} & flags.over_budget_ids(user.id, transactions)


class TestOverBudgetInMonth:
    class T:
        def __init__(self, id, cents):
            self.id, self.amount_cents = id, cents

    def test_flags_from_the_expense_that_crosses_the_allocation_on(self):
        expenses = [self.T(1, -2_000), self.T(2, -2_500), self.T(3, -1_000), self.T(4, -500)]
        assert over_budget_in_month(expenses, 0, 5_000) == {3, 4}

    def test_reaching_the_allocation_exactly_is_not_over(self):
        assert over_budget_in_month([self.T(1, -5_000)], 0, 5_000) == set()

    def test_reimbursements_are_credited_up_front(self):
        assert over_budget_in_month([self.T(1, -2_000), self.T(2, -4_000)], 1_000, 5_000) == set()


class TestBudgetFlags:
    def test_a_month_over_budget_flags_from_the_crossing_on(self, user, account):
        budgets.create_budget(user.id, 'Groceries', '2026-01', 50.0)
        a = _expense(account, date(2026, 1, 3), -20)
        b = _expense(account, date(2026, 1, 10), -25)
        c = _expense(account, date(2026, 1, 20), -10)
        moved_money = _expense(account, date(2026, 1, 21), -100, is_transfer=True)   # transfers don't count
        february = _expense(account, date(2026, 2, 1), -80)                            # no February budget
        assert _flagged(user, [a, b, c, moved_money, february]) == {c.id}

    def test_reimbursements_offset_the_whole_month(self, user, account):
        budgets.create_budget(user.id, 'Groceries', '2026-01', 50.0)
        expenses = [_expense(account, date(2026, 1, 3), -20), _expense(account, date(2026, 1, 10), -35)]
        account_svc.add_transaction(account.id, date(2026, 1, 28), 'Refund', 'Groceries', 10.0, is_reimbursement=True)
        assert _flagged(user, expenses) == set()

    def test_carried_over_money_raises_the_allocation(self, user, account):
        budgets.create_budget(user.id, 'Groceries', '2026-01', 40.0, rollover=True, carried_over=15.0)
        assert _flagged(user, [_expense(account, date(2026, 1, 3), -55)]) == set()

    def test_the_walk_counts_expenses_outside_the_ones_asked_about(self, user, account):
        budgets.create_budget(user.id, 'Groceries', '2026-01', 50.0)
        _expense(account, date(2026, 1, 3), -45)
        later = _expense(account, date(2026, 1, 10), -10)
        assert _flagged(user, [later]) == {later.id}

    def test_spending_is_per_user_across_accounts(self, user, account):
        other = AccountModel(user_id=user.id, acct_id_str='card-1', acct_name='Card')
        _db.session.add(other)
        _db.session.commit()
        budgets.create_budget(user.id, 'Groceries', '2026-01', 50.0)
        _expense(other, date(2026, 1, 3), -45)
        assert _flagged(user, [_expense(account, date(2026, 1, 10), -10)]) != set()


class TestNoChangeLeavesAFlagStale:
    """Each of these left a stored flag wrong; computed flags follow every change."""

    @pytest.fixture
    def over(self, user, account):
        """January Groceries: budget $50, spending $20 + $25 + $10, so the $10 (Jan 20) is over."""
        budgets.create_budget(user.id, 'Groceries', '2026-01', 50.0)
        return [_expense(account, date(2026, 1, 3), -20), _expense(account, date(2026, 1, 10), -25),
                _expense(account, date(2026, 1, 20), -10)]

    def test_moving_an_expense_to_another_category(self, user, over):
        account_svc.update_transaction(over[1].id, {'category': 'Gifts', 'is_reimbursement': False})
        assert _flagged(user, over) == set()   # Groceries is back under; Gifts has no budget

    def test_moving_an_expense_to_another_month(self, user, over):
        account_svc.update_transaction(over[1].id, {'date': '2026-02-10', 'is_reimbursement': False})
        assert _flagged(user, over) == set()

    def test_deleting_a_reimbursement(self, user, account):
        budgets.create_budget(user.id, 'Groceries', '2026-01', 50.0)
        spent = [_expense(account, date(2026, 1, 3), -40), _expense(account, date(2026, 1, 10), -20)]
        refund = account_svc.add_transaction(account.id, date(2026, 1, 28), 'Refund', 'Groceries', 15.0,
                                             is_reimbursement=True)
        assert _flagged(user, spent) == set()
        account_svc.delete_transaction(refund.id)
        assert _flagged(user, spent) == {spent[1].id}

    def test_marking_an_expense_as_a_transfer(self, user, over):
        over[1].is_transfer = True   # what the transfer toggle does
        _db.session.commit()
        assert _flagged(user, over) == set()

    def test_deleting_another_account(self, user, account):
        card = AccountModel(user_id=user.id, acct_id_str='card-1', acct_name='Card')
        _db.session.add(card)
        _db.session.commit()
        budgets.create_budget(user.id, 'Groceries', '2026-01', 50.0)
        _expense(card, date(2026, 1, 3), -45)
        mine = _expense(account, date(2026, 1, 10), -10)
        assert _flagged(user, [mine]) == {mine.id}
        account_svc.delete_account(card.id)
        assert _flagged(user, [mine]) == set()


class TestTransactionDicts:
    def test_serialized_transactions_carry_the_computed_flag(self, user, account):
        budgets.create_budget(user.id, 'Groceries', '2026-01', 50.0)
        a = _expense(account, date(2026, 1, 3), -45)
        b = _expense(account, date(2026, 1, 10), -10)
        b.over_budget = False   # a stale stored value is ignored
        _db.session.commit()
        assert [(d['id'], d['over_budget']) for d in flags.transaction_dicts(user.id, [a, b])] == [
            (a.id, False), (b.id, True)]

    def test_no_transactions(self, user):
        assert flags.transaction_dicts(user.id, []) == []
