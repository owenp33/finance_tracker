"""
Interest on any account: a yearly rate (apr_bps) that hits monthly, quarterly or yearly, on the
1st of each period, as an "Interest" transaction of the rate's share for the period of the balance
at the end of the period before. A loan is charged on what it owes (earlier interest included); a
bank account is paid on a positive balance, and that's income. Interest starts going forward from
the period the rate is set in, and catches up any periods the app missed (at login, on page load,
in the daily job), each period once.
"""
from datetime import date

import pytest
from sqlalchemy import func, text

from extensions import db as _db
from models.account import AccountModel
from models.transaction import TransactionModel
from services.account_service import AccountService
from services.db_service import DbService
from services.interest_service import InterestService

account_svc = AccountService()
db_svc = DbService()
interest = InterestService()


@pytest.fixture
def loan(user):
    """$75,217.00 owed at 6.70% a year, charged monthly, booked through Nov 1, 2026."""
    a = AccountModel(user_id=user.id, acct_id_str='student-1', acct_name='Student Loan', kind='loan', apr_bps=670,
                     interest_frequency='monthly', opening_balance_cents=-7521700, balance_cents=-7521700,
                     interest_through=date(2026, 11, 1))
    _db.session.add(a)
    _db.session.commit()
    return a


@pytest.fixture
def savings(user):
    """$3,000.00 held at 0.50% a year, paid yearly, booked through Jan 1, 2026."""
    a = AccountModel(user_id=user.id, acct_id_str='savings-1', acct_name='Savings', kind='bank', apr_bps=50,
                     interest_frequency='yearly', opening_balance_cents=300000, balance_cents=300000,
                     interest_through=date(2026, 1, 1))
    _db.session.add(a)
    _db.session.commit()
    return a


def hits(account):
    """The account's interest: (date, cents, notes)."""
    rows = TransactionModel.query.filter_by(account_id=account.id, category='Interest').order_by(TransactionModel.date)
    return [(t.date, t.amount_cents, t.notes) for t in rows]


def balance(account):
    """The stored balance, after checking it's still the starting balance plus the transactions."""
    _db.session.expire(account)
    total = _db.session.query(func.coalesce(func.sum(TransactionModel.amount_cents), 0)) \
        .filter(TransactionModel.account_id == account.id).scalar()
    assert account.balance_cents == account.opening_balance_cents + total
    return account.balance_cents


class TestALoanIsCharged:
    def test_each_month_a_twelfth_of_the_rate_on_what_was_owed(self, loan):
        # $75,217.00 × 6.70% ÷ 12 = $419.96
        assert interest.accrue(loan.id, today=date(2026, 12, 15)) == 1
        assert hits(loan) == [(date(2026, 12, 1), -41996, '6.70% a year, charged monthly, on $75,217.00 owed')]
        row = TransactionModel.query.filter_by(account_id=loan.id).one()
        assert (row.vendor, row.category) == ('Interest', 'Interest')
        assert (loan.interest_through, balance(loan)) == (date(2026, 12, 1), -7521700 - 41996)

    def test_missed_months_catch_up_in_order_each_on_what_was_owed_then(self, loan):
        # $75 paid on the 15th of each month; five months' interest at once, on Apr 10, 2027
        for month in (12, 1, 2, 3):
            account_svc.add_transaction(loan.id, date(2026 if month == 12 else 2027, month, 15), 'ASPIRE', 'Loan', 75.0)
        assert interest.accrue(loan.id, today=date(2027, 4, 10)) == 5
        assert [(day, cents) for day, cents, _ in hits(loan)] == [
            (date(2026, 12, 1), -41996), (date(2027, 1, 1), -42189), (date(2027, 2, 1), -42382),
            (date(2027, 3, 1), -42577), (date(2027, 4, 1), -42773),
        ]
        assert (loan.interest_through, balance(loan)) == (date(2027, 4, 1), -7703617)

    def test_nothing_is_charged_while_nothing_is_owed(self, loan):
        account_svc.update_account(loan.id, {'balance': 0})
        assert interest.accrue(loan.id, today=date(2027, 1, 5)) == 0
        assert (hits(loan), loan.interest_through) == ([], date(2027, 1, 1))     # those months are done


class TestABankAccountIsPaid:
    def test_a_positive_balance_earns_the_rate_for_the_period_as_income(self, savings):
        # $3,000.00 × 0.50% = $15.00, paid on Jan 1, 2027
        assert interest.accrue(savings.id, today=date(2027, 1, 2)) == 1
        assert hits(savings) == [(date(2027, 1, 1), 1500, '0.50% a year, paid yearly, on $3,000.00')]
        row = TransactionModel.query.filter_by(account_id=savings.id).one()
        assert (row.is_transfer, row.to_dict()['on_loan_account']) == (False, False)    # so it's income
        assert balance(savings) == 301500

    def test_a_negative_balance_earns_and_owes_nothing(self, savings):
        account_svc.update_account(savings.id, {'balance': -50})
        assert interest.accrue(savings.id, today=date(2027, 1, 2)) == 0
        assert (hits(savings), savings.interest_through) == ([], date(2027, 1, 1))

    def test_quarterly_interest_hits_on_each_quarters_first_day(self, savings):
        # $10,000.00 at 4% a year, paid quarterly: $100.00 on Jan 1, then $101.00 on Apr 1 on $10,100.00
        savings.apr_bps, savings.interest_frequency, savings.interest_through = 400, 'quarterly', date(2026, 10, 1)
        _db.session.commit()
        account_svc.update_account(savings.id, {'balance': 10000})
        assert interest.accrue(savings.id, today=date(2027, 4, 10)) == 2
        assert [(day, cents) for day, cents, _ in hits(savings)] == [(date(2027, 1, 1), 10000), (date(2027, 4, 1), 10100)]
        assert savings.interest_through == date(2027, 4, 1)

    def test_yearly_interest_waits_for_the_new_year(self, savings):
        assert interest.accrue(savings.id, today=date(2026, 12, 31)) == 0
        assert hits(savings) == []


class TestOncePerPeriod:
    def test_a_period_is_paid_once_however_often_it_runs(self, loan):
        interest.accrue(loan.id, today=date(2026, 12, 1))
        assert interest.accrue(loan.id, today=date(2026, 12, 20)) == 0
        assert len(hits(loan)) == 1

    def test_a_deleted_charge_is_not_booked_again(self, loan):
        interest.accrue(loan.id, today=date(2026, 12, 15))
        account_svc.delete_transaction(TransactionModel.query.filter_by(account_id=loan.id).one().id)
        interest.accrue(loan.id, today=date(2026, 12, 20))
        assert (hits(loan), balance(loan)) == ([], -7521700)

    def test_another_run_that_already_booked_the_period_wins(self, loan):
        db_svc.get_account(loan.id).interest_through        # loaded now, and about to be out of date
        _db.session.execute(text('UPDATE accounts SET interest_through = :day WHERE id = :id'),
                            {'day': '2026-12-01', 'id': loan.id})
        assert interest.accrue(loan.id, today=date(2026, 12, 15)) == 0
        assert hits(loan) == []

    def test_nothing_hits_without_a_rate(self, loan, account):
        account_svc.update_account(loan.id, {'apr': None})
        assert interest.accrue(loan.id, today=date(2027, 1, 5)) == 0
        assert interest.accrue(account.id, today=date(2027, 1, 5)) == 0
        assert hits(loan) == []

    def test_an_account_without_a_start_starts_going_forward_from_this_period(self, loan):
        loan.interest_through = None       # a rate set before interest was booked
        _db.session.commit()
        assert interest.accrue(loan.id, today=date(2026, 11, 15)) == 0
        assert (hits(loan), loan.interest_through) == ([], date(2026, 11, 1))
        assert interest.accrue(loan.id, today=date(2026, 12, 2)) == 1


class TestSettingTheRate:
    def test_a_bank_account_can_earn_interest_and_says_how_often(self, user, account, pin_today):
        pin_today(date(2026, 11, 15))
        created = account_svc.create_account(user.id, {'account_id': 'savings-2', 'apr': 0.5, 'interest_frequency': 'yearly'})
        assert (created.kind, created.apr_bps, created.interest_frequency) == ('bank', 50, 'yearly')
        assert created.to_dict()['interest_frequency'] == 'yearly'
        assert created.interest_through == date(2026, 1, 1)           # this year counts as done: first on Jan 1, 2027
        account_svc.update_account(account.id, {'apr': 4, 'interest_frequency': 'quarterly'})
        assert (account.interest_frequency, account.interest_through) == ('quarterly', date(2026, 10, 1))

    def test_a_rate_without_a_frequency_hits_monthly(self, user, pin_today):
        pin_today(date(2026, 11, 15))
        loan = account_svc.create_account(user.id, {'account_id': 'aspire-1', 'kind': 'loan', 'apr': 6.7})
        assert (loan.interest_frequency, loan.interest_through) == ('monthly', date(2026, 11, 1))
        waiting = account_svc.create_account(user.id, {'account_id': 'aspire-2', 'kind': 'loan'})
        assert (waiting.interest_frequency, waiting.interest_through) == (None, None)

    def test_a_new_rate_keeps_the_periods_done_and_a_new_frequency_starts_from_its_period(self, loan, pin_today):
        pin_today(date(2026, 11, 15))
        account_svc.update_account(loan.id, {'apr': 7.0})
        assert loan.interest_through == date(2026, 11, 1)
        account_svc.update_account(loan.id, {'interest_frequency': 'yearly'})
        assert (loan.interest_frequency, loan.interest_through) == ('yearly', date(2026, 1, 1))

    def test_clearing_the_rate_stops_it_and_its_frequency(self, loan, pin_today):
        pin_today(date(2026, 11, 15))
        account_svc.update_account(loan.id, {'apr': None})
        assert (loan.apr_bps, loan.interest_frequency, loan.interest_through) == (None, None, None)
        account_svc.update_account(loan.id, {'apr': 6.7})                # starts again from this month
        assert (loan.interest_frequency, loan.interest_through) == ('monthly', date(2026, 11, 1))

    def test_changing_the_type_keeps_the_rate(self, loan):
        account_svc.update_account(loan.id, {'kind': 'bank'})
        assert (loan.kind, loan.apr_bps, loan.interest_frequency, loan.interest_through) == \
            ('bank', 670, 'monthly', date(2026, 11, 1))


class TestCatchUpOnLoad:
    def test_login_and_page_loads_book_the_interest_due(self, client, loan, pin_today):
        pin_today(date(2026, 12, 3))
        login = client.post('/api/auth/login', json={'username': 'testuser', 'password': 'testpass'})
        assert login.status_code == 200
        assert [day for day, _, _ in hits(loan)] == [date(2026, 12, 1)]
        pin_today(date(2027, 1, 2))                                   # the page loads again a month later
        me = client.get('/api/auth/me', headers={'Authorization': f"Bearer {login.json['access_token']}"})
        assert me.status_code == 200
        assert [day for day, _, _ in hits(loan)] == [date(2026, 12, 1), date(2027, 1, 1)]
