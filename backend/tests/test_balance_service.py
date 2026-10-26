"""
Balance core tests: per-account ledgers (opening balance, running balance after each
transaction, closing balance) used by the exports.
"""
from datetime import date

import pytest

from extensions import db as _db
from models.account import AccountModel
from models.user import User
from services.account_service import AccountService
from services.balance_service import BalanceService, LedgerRow, running_balances

account_svc = AccountService()
balances = BalanceService()


def _tx(account, day, amount, vendor='Shop', **flags):
    return account_svc.add_transaction(account.id, day, vendor, 'Misc', amount, **flags)


def _rows(ledger):
    return [(row.transaction.date, row.transaction.amount_cents, row.balance_cents) for row in ledger.rows]


@pytest.fixture
def savings(user):
    # The stored balance includes the starting balance, as update_account keeps it
    a = AccountModel(user_id=user.id, acct_id_str='savings-1', acct_name='Savings',
                     opening_balance_cents=100_000, balance_cents=100_000)
    _db.session.add(a)
    _db.session.commit()
    return a


class TestRunningBalances:
    def test_each_row_carries_the_balance_right_after_it(self):
        class T:
            def __init__(self, cents):
                self.amount_cents = cents
        a, b, c = T(-2_000), T(5_000), T(-500)
        assert running_balances(10_000, [a, b, c]) == [LedgerRow(a, 8_000), LedgerRow(b, 13_000), LedgerRow(c, 12_500)]

    def test_no_transactions_no_rows(self):
        assert running_balances(10_000, []) == []


class TestLedgers:
    def test_the_whole_history_starts_at_the_starting_balance_and_ends_at_the_stored_balance(self, user, account, savings):
        account_svc.update_account(account.id, {'opening_balance': 250})
        _tx(account, date(2026, 1, 5), -40)
        _tx(account, date(2026, 2, 1), 1_000)
        _tx(savings, date(2026, 1, 10), -300)
        for ledger in balances.ledgers(user.id):
            assert ledger.closing_cents == ledger.account.balance_cents
        [checking, saved] = balances.ledgers(user.id)
        assert (checking.opening_cents, _rows(checking)) == (
            25_000, [(date(2026, 1, 5), -4_000, 21_000), (date(2026, 2, 1), 100_000, 121_000)])
        assert (saved.opening_cents, saved.closing_cents) == (100_000, 70_000)

    def test_a_period_opens_with_everything_before_it(self, user, account):
        account_svc.update_account(account.id, {'opening_balance': 100})
        _tx(account, date(2026, 1, 15), -20)
        _tx(account, date(2026, 2, 1), -30)
        _tx(account, date(2026, 2, 28), 50)
        _tx(account, date(2026, 3, 1), -5)
        [ledger] = balances.ledgers(user.id, start_date=date(2026, 2, 1), end_date=date(2026, 2, 28))
        assert ledger.opening_cents == 8_000
        assert _rows(ledger) == [(date(2026, 2, 1), -3_000, 5_000), (date(2026, 2, 28), 5_000, 10_000)]
        assert ledger.closing_cents == 10_000

    def test_same_day_transactions_run_in_the_order_they_were_added(self, user, account):
        first = _tx(account, date(2026, 1, 5), -10)
        second = _tx(account, date(2026, 1, 5), 25)
        [ledger] = balances.ledgers(user.id)
        assert [row.transaction.id for row in ledger.rows] == [first.id, second.id]

    def test_transfers_and_reimbursements_move_the_balance(self, user, account):
        _tx(account, date(2026, 1, 5), -100, is_transfer=True)
        _tx(account, date(2026, 1, 6), 40, is_reimbursement=True)
        [ledger] = balances.ledgers(user.id)
        assert ledger.closing_cents == -6_000

    def test_an_account_without_activity_in_the_period_still_has_a_ledger(self, user, account, savings):
        _tx(account, date(2026, 1, 5), -10)
        ledgers = balances.ledgers(user.id, start_date=date(2026, 2, 1))
        quiet = next(l for l in ledgers if l.account.id == savings.id)
        assert (quiet.rows, quiet.opening_cents, quiet.closing_cents) == ([], 100_000, 100_000)

    def test_only_the_requested_accounts(self, user, account, savings):
        assert [l.account.id for l in balances.ledgers(user.id, account_ids=[savings.id])] == [savings.id]

    def test_rejects_an_account_that_is_not_the_users(self, user, account):
        other = User(username='other', email='other@example.com')
        other.set_password('otherpass')
        _db.session.add(other)
        _db.session.flush()
        theirs = AccountModel(user_id=other.id, acct_id_str='x', acct_name='Theirs')
        _db.session.add(theirs)
        _db.session.commit()
        with pytest.raises(ValueError, match=f'^Unknown account: {theirs.id}$'):
            balances.ledgers(user.id, account_ids=[account.id, theirs.id])

    def test_rejects_a_start_after_the_end(self, user, account):
        with pytest.raises(ValueError, match='^The start date must be on or before the end date.$'):
            balances.ledgers(user.id, start_date=date(2026, 3, 1), end_date=date(2026, 2, 1))
