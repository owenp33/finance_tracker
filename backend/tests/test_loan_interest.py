"""
Monthly loan interest: on each 1st, a loan with an APR is charged APR / 12 of everything owed at
the end of the month before (earlier interest included), as an "Interest" transaction. It starts
going forward from the 1st on or before the day the APR is set, and catches up any months the app
missed (at login, on page load, in the daily job), each month once.
"""
from datetime import date

import pytest
from sqlalchemy import func, text

from extensions import db as _db
from models.account import AccountModel
from models.transaction import TransactionModel
from services.account_service import AccountService
from services.db_service import DbService
from services.loan_service import LoanService

account_svc = AccountService()
db_svc = DbService()
loans = LoanService()


@pytest.fixture
def loan(user):
    """$75,217.00 owed at 6.70%, its interest booked through Nov 1, 2026."""
    a = AccountModel(user_id=user.id, acct_id_str='student-1', acct_name='Student Loan', kind='loan', apr_bps=670,
                     opening_balance_cents=-7521700, balance_cents=-7521700, interest_through=date(2026, 11, 1))
    _db.session.add(a)
    _db.session.commit()
    return a


def charges(loan):
    """The loan's interest charges: (date, cents, notes)."""
    rows = TransactionModel.query.filter_by(account_id=loan.id, category='Interest').order_by(TransactionModel.date)
    return [(t.date, t.amount_cents, t.notes) for t in rows]


def balance(account):
    """The stored balance, after checking it's still the starting balance plus the transactions."""
    _db.session.expire(account)
    total = _db.session.query(func.coalesce(func.sum(TransactionModel.amount_cents), 0)) \
        .filter(TransactionModel.account_id == account.id).scalar()
    assert account.balance_cents == account.opening_balance_cents + total
    return account.balance_cents


class TestMonthlyInterest:
    def test_each_first_is_charged_a_twelfth_of_the_apr_on_what_was_owed(self, loan):
        # $75,217.00 × 6.70% ÷ 12 = $419.96
        assert loans.accrue_interest(loan.id, today=date(2026, 12, 15)) == 1
        assert charges(loan) == [(date(2026, 12, 1), -41996, '6.70% APR on $75,217.00')]
        row = TransactionModel.query.filter_by(account_id=loan.id).one()
        assert (row.vendor, row.category, row.loan_payment_id) == ('Interest', 'Interest', None)
        assert (loan.interest_through, balance(loan)) == (date(2026, 12, 1), -7521700 - 41996)

    def test_missed_months_catch_up_in_order_each_on_what_was_owed_then(self, loan):
        # $75 paid on the 15th of each month; five months' interest at once, on Apr 10, 2027
        for month in (12, 1, 2, 3):
            account_svc.add_transaction(loan.id, date(2026 if month == 12 else 2027, month, 15), 'ASPIRE', 'Loan', 75.0)
        assert loans.accrue_interest(loan.id, today=date(2027, 4, 10)) == 5
        assert [(day, cents) for day, cents, _ in charges(loan)] == [
            (date(2026, 12, 1), -41996), (date(2027, 1, 1), -42189), (date(2027, 2, 1), -42382),
            (date(2027, 3, 1), -42577), (date(2027, 4, 1), -42773),
        ]
        assert (loan.interest_through, balance(loan)) == (date(2027, 4, 1), -7703617)

    def test_a_month_is_charged_once_however_often_it_runs(self, loan):
        loans.accrue_interest(loan.id, today=date(2026, 12, 1))
        assert loans.accrue_interest(loan.id, today=date(2026, 12, 20)) == 0
        assert len(charges(loan)) == 1

    def test_a_deleted_charge_is_not_booked_again(self, loan):
        loans.accrue_interest(loan.id, today=date(2026, 12, 15))
        account_svc.delete_transaction(TransactionModel.query.filter_by(account_id=loan.id).one().id)
        loans.accrue_interest(loan.id, today=date(2026, 12, 20))
        assert (charges(loan), balance(loan)) == ([], -7521700)

    def test_nothing_is_charged_while_nothing_is_owed(self, loan):
        account_svc.update_account(loan.id, {'balance': 0})
        assert loans.accrue_interest(loan.id, today=date(2027, 1, 5)) == 0
        assert (charges(loan), loan.interest_through) == ([], date(2027, 1, 1))     # those months are done

    def test_nothing_is_charged_without_an_apr_or_on_a_bank_account(self, loan, account):
        account_svc.update_account(loan.id, {'apr': None})
        assert loans.accrue_interest(loan.id, today=date(2027, 1, 5)) == 0
        assert loans.accrue_interest(account.id, today=date(2027, 1, 5)) == 0
        assert charges(loan) == []

    def test_a_loan_without_a_start_starts_going_forward_from_the_latest_first(self, loan):
        loan.interest_through = None       # an APR set before monthly interest existed
        _db.session.commit()
        assert loans.accrue_interest(loan.id, today=date(2026, 11, 15)) == 0
        assert (charges(loan), loan.interest_through) == ([], date(2026, 11, 1))
        assert loans.accrue_interest(loan.id, today=date(2026, 12, 2)) == 1

    def test_another_run_that_already_charged_the_month_wins(self, loan):
        db_svc.get_account(loan.id).interest_through        # loaded now, and about to be out of date
        _db.session.execute(text('UPDATE accounts SET interest_through = :day WHERE id = :id'),
                            {'day': '2026-12-01', 'id': loan.id})
        assert loans.accrue_interest(loan.id, today=date(2026, 12, 15)) == 0
        assert charges(loan) == []


class TestWhenInterestStarts:
    def test_setting_an_apr_starts_it_from_this_months_first(self, account, pin_today):
        pin_today(date(2026, 11, 15))
        account_svc.update_account(account.id, {'kind': 'loan', 'apr': 6.7})
        assert account.interest_through == date(2026, 11, 1)
        account_svc.update_account(account.id, {'apr': 7.0})          # a new rate keeps the months done
        assert account.interest_through == date(2026, 11, 1)

    def test_clearing_the_apr_or_making_it_a_bank_account_stops_it(self, loan, pin_today):
        pin_today(date(2026, 11, 15))
        account_svc.update_account(loan.id, {'apr': None})
        assert loan.interest_through is None
        account_svc.update_account(loan.id, {'apr': 6.7})               # starts again from this month
        assert loan.interest_through == date(2026, 11, 1)
        account_svc.update_account(loan.id, {'kind': 'bank'})
        assert loan.interest_through is None

    def test_a_new_loan_with_an_apr_starts_from_this_months_first(self, user, pin_today):
        pin_today(date(2026, 11, 15))
        created = account_svc.create_account(user.id, {'account_id': 'aspire-1', 'kind': 'loan', 'apr': 6.7})
        waiting = account_svc.create_account(user.id, {'account_id': 'aspire-2', 'kind': 'loan'})
        assert (created.interest_through, waiting.interest_through) == (date(2026, 11, 1), None)


class TestCatchUpOnLoad:
    def test_login_and_page_loads_charge_the_months_due(self, client, loan, pin_today):
        pin_today(date(2026, 12, 3))
        login = client.post('/api/auth/login', json={'username': 'testuser', 'password': 'testpass'})
        assert login.status_code == 200
        assert [day for day, _, _ in charges(loan)] == [date(2026, 12, 1)]
        pin_today(date(2027, 1, 2))                                   # the page loads again a month later
        me = client.get('/api/auth/me', headers={'Authorization': f"Bearer {login.json['access_token']}"})
        assert me.status_code == 200
        assert [day for day, _, _ in charges(loan)] == [date(2026, 12, 1), date(2027, 1, 1)]
