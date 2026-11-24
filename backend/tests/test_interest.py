"""
Interest on any account: a yearly rate (apr_bps) that hits monthly, quarterly or yearly, on the
1st of each period, the rate's share for the period of the balance at the end of the period before.
A loan is charged on what it owes (earlier interest included); a bank account is paid on a positive
balance. Each hit is a record of its own (interest_hits), not a transaction, and waits for the user's
approval: until then it moves nothing, though the next period's interest counts it (the bank charges
it either way); while it waits, its amount can be changed to the bank's figure, or it can be deleted
(the period stays done). Approving applies it to the balance and the balance history, once; it counts
in no income or spending total. Interest starts going forward from the period the rate is set in,
and catches up any periods the app missed (at login, on page load, in the daily job), each period once.
"""
import csv
import io
import re
from datetime import date

import pytest
from sqlalchemy import func, text

from extensions import db as _db
from models.account import AccountModel
from models.interest_hit import InterestHitModel
from models.recurring import RecurringModel
from models.transaction import TransactionModel
from models.user import User
from services.account_service import AccountService
from services.analytics_service import AnalyticsService
from services.balance_service import BalanceService
from services.db_service import DbService
from services.interest_service import InterestService
from services.reports import pdf_pages

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
    """The account's interest hits: (date, cents, the rate in bps, how often, the balance it was on)."""
    rows = InterestHitModel.query.filter_by(account_id=account.id).order_by(InterestHitModel.date)
    return [(h.date, h.amount_cents, h.apr_bps, h.frequency, h.base_cents) for h in rows]


def approvals(account):
    """Each of the account's hits: (date, whether it's approved)."""
    rows = InterestHitModel.query.filter_by(account_id=account.id).order_by(InterestHitModel.date)
    return [(h.date, h.approved) for h in rows]


def only_hit(account):
    return InterestHitModel.query.filter_by(account_id=account.id).one()


def approve_all(account):
    """Approve the account's hits waiting for approval, oldest first."""
    for hit in InterestHitModel.query.filter_by(account_id=account.id, approved=False).order_by(InterestHitModel.date).all():
        interest.approve_hit(hit.id)


def balance(account):
    """
    The stored balance, after checking it's still the starting balance plus the account's
    transactions and approved interest hits, less the payments of the series paying it down.
    """
    _db.session.expire(account)
    own = _db.session.query(func.coalesce(func.sum(TransactionModel.amount_cents), 0)) \
        .filter(TransactionModel.account_id == account.id).scalar()
    hit = _db.session.query(func.coalesce(func.sum(InterestHitModel.amount_cents), 0)) \
        .filter(InterestHitModel.account_id == account.id, InterestHitModel.approved.is_(True)).scalar()
    paid = _db.session.query(func.coalesce(func.sum(TransactionModel.amount_cents), 0)) \
        .join(RecurringModel, TransactionModel.recurring_id == RecurringModel.id) \
        .filter(RecurringModel.loan_account_id == account.id).scalar()
    assert account.balance_cents == account.opening_balance_cents + own + hit - paid
    return account.balance_cents


def booked_transactions(account):
    return TransactionModel.query.filter_by(account_id=account.id).count()


class TestALoanIsCharged:
    def test_each_month_a_twelfth_of_the_rate_on_what_was_owed_applied_once_approved(self, loan):
        # $75,217.00 × 6.70% ÷ 12 = $419.96
        assert interest.accrue(loan.id, today=date(2026, 12, 15)) == 1
        assert hits(loan) == [(date(2026, 12, 1), -41996, 670, 'monthly', 7521700)]
        assert approvals(loan) == [(date(2026, 12, 1), False)]
        assert booked_transactions(loan) == 0                              # a record of its own, not a transaction
        assert (loan.interest_through, balance(loan)) == (date(2026, 12, 1), -7521700)   # waiting: nothing moves
        approve_all(loan)
        assert (approvals(loan), balance(loan)) == ([(date(2026, 12, 1), True)], -7521700 - 41996)
        assert loan.opening_balance_cents == -7521700                       # the starting balance stays

    def test_missed_months_catch_up_in_order_each_on_what_was_owed_then(self, loan):
        # $75 paid on the 15th of each month; five months' interest at once, on Apr 10, 2027, each on
        # what was owed with the charges before it, though those are still waiting for approval
        for month in (12, 1, 2, 3):
            account_svc.add_transaction(loan.id, date(2026 if month == 12 else 2027, month, 15), 'ASPIRE', 'Loan', 75.0)
        assert interest.accrue(loan.id, today=date(2027, 4, 10)) == 5
        assert [(day, cents) for day, cents, *_ in hits(loan)] == [
            (date(2026, 12, 1), -41996), (date(2027, 1, 1), -42189), (date(2027, 2, 1), -42382),
            (date(2027, 3, 1), -42577), (date(2027, 4, 1), -42773),
        ]
        assert balance(loan) == -7521700 + 30000                            # the payments, no interest yet
        approve_all(loan)
        assert (loan.interest_through, balance(loan)) == (date(2027, 4, 1), -7703617)

    def test_nothing_is_charged_while_nothing_is_owed(self, loan):
        account_svc.update_account(loan.id, {'balance': 0})
        assert interest.accrue(loan.id, today=date(2027, 1, 5)) == 0
        assert (hits(loan), loan.interest_through) == ([], date(2027, 1, 1))     # those months are done


class TestABankAccountIsPaid:
    def test_a_positive_balance_earns_the_rate_for_the_period_counted_in_no_total(self, savings):
        # $3,000.00 × 0.50% = $15.00, paid on Jan 1, 2027
        assert interest.accrue(savings.id, today=date(2027, 1, 2)) == 1
        assert hits(savings) == [(date(2027, 1, 1), 1500, 50, 'yearly', 300000)]
        assert booked_transactions(savings) == 0                           # so it's in no income total
        assert balance(savings) == 300000
        approve_all(savings)
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
        assert [(day, cents, base) for day, cents, _, _, base in hits(savings)] == [
            (date(2027, 1, 1), 10000, 1000000), (date(2027, 4, 1), 10100, 1010000)]
        assert savings.interest_through == date(2027, 4, 1)

    def test_yearly_interest_waits_for_the_new_year(self, savings):
        assert interest.accrue(savings.id, today=date(2026, 12, 31)) == 0
        assert hits(savings) == []


class TestOncePerPeriod:
    def test_a_period_is_paid_once_however_often_it_runs(self, loan):
        interest.accrue(loan.id, today=date(2026, 12, 1))
        assert interest.accrue(loan.id, today=date(2026, 12, 20)) == 0
        assert len(hits(loan)) == 1

    def test_a_hit_set_to_nothing_is_not_booked_again(self, loan):
        interest.accrue(loan.id, today=date(2026, 12, 15))
        interest.update_hit(only_hit(loan).id, 0)
        interest.accrue(loan.id, today=date(2026, 12, 20))
        assert (hits(loan), balance(loan)) == ([(date(2026, 12, 1), 0, 670, 'monthly', 7521700)], -7521700)

    def test_a_deleted_hit_is_not_booked_again(self, loan):
        interest.accrue(loan.id, today=date(2026, 12, 15))
        interest.delete_hit(only_hit(loan).id)
        assert interest.accrue(loan.id, today=date(2026, 12, 20)) == 0
        assert (hits(loan), balance(loan), loan.interest_through) == ([], -7521700, date(2026, 12, 1))

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


class TestWaitingForApproval:
    def test_a_loans_charge_takes_the_banks_figure_and_is_applied_at_it(self, loan):
        interest.accrue(loan.id, today=date(2026, 12, 15))
        hit = interest.update_hit(only_hit(loan).id, 425.10)
        assert (hit.amount_cents, balance(loan)) == (-42510, -7521700)          # still waiting: nothing moves
        interest.approve_hit(hit.id)
        assert balance(loan) == -7521700 - 42510                                # charged: what's owed grows

    def test_a_bank_accounts_payment_takes_the_banks_figure(self, savings):
        interest.accrue(savings.id, today=date(2027, 1, 2))
        interest.update_hit(only_hit(savings).id, 16)
        approve_all(savings)
        assert (hits(savings)[0][1], balance(savings)) == (1600, 301600)

    def test_a_charge_still_waiting_counts_toward_the_next_ones_balance(self, loan):
        interest.accrue(loan.id, today=date(2026, 12, 15))
        interest.accrue(loan.id, today=date(2027, 1, 2))
        # Dec 1's $419.96 isn't approved yet, but the bank charges it either way: Jan 1's is on $75,636.96
        assert hits(loan)[1][1:] == (-42231, 670, 'monthly', 7563696)

    def test_the_next_hit_is_on_the_balance_with_the_changed_one(self, loan):
        interest.accrue(loan.id, today=date(2026, 12, 15))
        interest.update_hit(only_hit(loan).id, 0)
        interest.accrue(loan.id, today=date(2027, 1, 2))
        assert hits(loan)[1][1:] == (-41996, 670, 'monthly', 7521700)       # on $75,217.00 again

    @pytest.mark.parametrize('amount, error', [
        ('abc', 'Interest must be a number.'),
        (True, 'Interest must be a number.'),
        (None, 'Interest must be a number.'),
        (float('nan'), 'Interest must be a number.'),
        (-1, "Interest can't be negative."),
        (10_000_000.01, 'Interest must be at most $10,000,000.00.'),
    ], ids=['text', 'bool', 'none', 'nan', 'negative', 'too-much'])
    def test_it_must_be_an_amount(self, loan, amount, error):
        interest.accrue(loan.id, today=date(2026, 12, 15))
        hit_id = only_hit(loan).id
        with pytest.raises(ValueError, match=f'^{re.escape(error)}$'):
            interest.update_hit(hit_id, amount)
        assert (hits(loan)[0][1], balance(loan)) == (-41996, -7521700)

    def test_once_approved_it_stays_as_it_was_applied(self, loan):
        interest.accrue(loan.id, today=date(2026, 12, 15))
        hit_id = only_hit(loan).id
        interest.approve_hit(hit_id)
        for change, error in ((lambda: interest.update_hit(hit_id, 1), "Approved interest can't be changed."),
                              (lambda: interest.delete_hit(hit_id), "Approved interest can't be deleted."),
                              (lambda: interest.approve_hit(hit_id), 'That interest is already approved.')):
            with pytest.raises(ValueError, match=f'^{re.escape(error)}$'):
                change()
        assert (approvals(loan), balance(loan)) == ([(date(2026, 12, 1), True)], -7521700 - 41996)

    def test_an_approval_that_got_there_first_wins(self, loan):
        interest.accrue(loan.id, today=date(2026, 12, 15))
        hit = only_hit(loan)                                # loaded now, and about to be out of date
        _db.session.execute(text('UPDATE interest_hits SET approved = TRUE WHERE id = :id'), {'id': hit.id})
        with pytest.raises(ValueError, match='^That interest is already approved.$'):
            interest.approve_hit(hit.id)
        _db.session.expire(loan)
        assert loan.balance_cents == -7521700               # not applied a second time here

    def test_a_missing_hit(self, loan):
        for change in (lambda: interest.update_hit(999999, 1), lambda: interest.approve_hit(999999),
                       lambda: interest.delete_hit(999999)):
            with pytest.raises(ValueError, match='^Interest not found.$'):
                change()

    def test_deleting_the_account_deletes_its_hits(self, loan):
        interest.accrue(loan.id, today=date(2026, 12, 15))
        account_svc.delete_account(loan.id)
        assert InterestHitModel.query.count() == 0


class TestTheBalanceCountsApprovedOnes:
    @pytest.fixture
    def charged(self, loan):
        interest.accrue(loan.id, today=date(2026, 12, 15))
        approve_all(loan)
        account_svc.add_transaction(loan.id, date(2026, 12, 1), 'Extra', 'Loan', 100.0)

    def test_a_current_balance_edit_keeps_them(self, loan, charged):
        account_svc.update_account(loan.id, {'balance': -70000})
        assert (balance(loan), loan.opening_balance_cents) == (-7000000, -7000000 + 41996 - 10000)
        assert account_svc.recalculate_account_balance(loan.id) == -70000.0

    def test_the_history_steps_on_the_1st_with_the_hit_before_that_days_transactions(self, user, loan, charged):
        [ledger] = BalanceService().ledgers(user.id, [loan.id])
        assert [(r.transaction.date, r.transaction.vendor, r.amount_cents, r.interest, r.balance_cents) for r in ledger.rows] == [
            (date(2026, 12, 1), 'Interest', -41996, True, -7563696),
            (date(2026, 12, 1), 'Extra', 10000, False, -7553696),
        ]
        assert ledger.closing_cents == balance(loan)

    def test_a_period_starts_from_the_hits_before_it(self, user, loan, charged):
        [ledger] = BalanceService().ledgers(user.id, [loan.id], start_date=date(2026, 12, 2))
        assert (ledger.opening_cents, ledger.rows) == (-7553696, [])

    def test_one_waiting_for_approval_counts_in_none_of_them(self, user, loan):
        interest.accrue(loan.id, today=date(2026, 12, 15))
        account_svc.update_account(loan.id, {'balance': -70000})
        assert loan.opening_balance_cents == -7000000                       # the edit leaves it out
        [ledger] = BalanceService().ledgers(user.id, [loan.id])
        assert (ledger.rows, ledger.closing_cents) == ([], balance(loan))
        [later] = BalanceService().ledgers(user.id, [loan.id], start_date=date(2026, 12, 2))
        assert later.opening_cents == -7000000


class TestReports:
    @pytest.fixture
    def paid(self, savings):
        account_svc.add_transaction(savings.id, date(2026, 12, 20), 'Deposit', 'Income', 100.0)
        interest.accrue(savings.id, today=date(2027, 1, 2))           # $15.50 on $3,100.00
        approve_all(savings)

    def test_the_csv_lists_transactions_only_its_running_balance_counting_interest(self, client, auth_headers, paid):
        rows = list(csv.reader(io.StringIO(client.get('/api/export/transactions.csv', headers=auth_headers)
                                           .get_data(as_text=True))))
        assert rows[1:] == [['Savings', '2026-12-20', 'Deposit', 'Income', '', '100.00', '', '3100.00']]

    def test_the_pdf_shows_them_on_the_accounts_page_and_in_no_total(self, client, auth_headers, monkeypatch, paid):
        summarised, pages = [], {}
        real_report, real_pages = AnalyticsService.generate_report, pdf_pages.render_account_pages
        monkeypatch.setattr(AnalyticsService, 'generate_report',
                            staticmethod(lambda txs: summarised.append([t.vendor for t in txs]) or real_report(txs)))

        def account_pages(pdf, ledger, over_budget_ids, *args):
            pages[ledger.account.acct_name] = [cells for cells, _ in pdf_pages.account_table_rows(ledger.rows, over_budget_ids)]
            return real_pages(pdf, ledger, over_budget_ids, *args)
        monkeypatch.setattr(pdf_pages, 'render_account_pages', account_pages)
        assert client.get('/api/export/report.pdf', headers=auth_headers).status_code == 200
        assert summarised == [['Deposit']]
        assert pages['Savings'] == [
            ['2026-12-20', 'Deposit', 'Income', '$100.00', '$3,100.00', ''],
            ['2027-01-01', 'Interest', 'Interest', '$15.50', '$3,115.50', ''],
        ]

    def test_the_balance_history_steps_on_the_1st(self, client, auth_headers, savings, paid):
        [entry] = client.get(f'/api/balances?account_ids={savings.id}', headers=auth_headers).json['balances']
        assert [(d['date'], d['balance_cents']) for d in entry['days']] == [('2026-12-20', 310000), ('2027-01-01', 311550)]


class TestInterestRoutes:
    @pytest.fixture
    def charged(self, loan):
        interest.accrue(loan.id, today=date(2026, 12, 15))
        return only_hit(loan)

    def test_listing_the_hits(self, client, auth_headers, loan, charged):
        resp = client.get('/api/interest', headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json['interest'] == [{
            'id': charged.id, 'account_id': loan.id, 'date': '2026-12-01', 'amount': -419.96, 'amount_cents': -41996,
            'apr': 6.7, 'frequency': 'monthly', 'base_cents': 7521700, 'approved': False,
        }]

    def test_changing_a_hit_returns_it_and_the_account(self, client, auth_headers, loan, charged):
        resp = client.patch(f'/api/interest/{charged.id}', json={'amount': 425.10}, headers=auth_headers)
        assert resp.status_code == 200
        assert (resp.json['interest']['amount_cents'], resp.json['account']['balance']) == (-42510, -75217.0)

    def test_approving_a_hit_applies_it_and_returns_the_account(self, client, auth_headers, loan, charged):
        resp = client.post(f'/api/interest/{charged.id}/approve', headers=auth_headers)
        assert resp.status_code == 200
        assert (resp.json['interest']['approved'], resp.json['account']['balance']) == (True, -75636.96)
        again = client.post(f'/api/interest/{charged.id}/approve', headers=auth_headers)
        assert (again.status_code, again.json) == (400, {'success': False, 'error': 'That interest is already approved.'})

    def test_deleting_a_hit(self, client, auth_headers, loan, charged):
        resp = client.delete(f'/api/interest/{charged.id}', headers=auth_headers)
        assert (resp.status_code, resp.json) == (200, {'success': True})
        assert client.get('/api/interest', headers=auth_headers).json['interest'] == []
        assert balance(loan) == -7521700

    def test_approved_interest_cant_be_changed_or_deleted(self, client, auth_headers, charged):
        client.post(f'/api/interest/{charged.id}/approve', headers=auth_headers)
        changed = client.patch(f'/api/interest/{charged.id}', json={'amount': 1}, headers=auth_headers)
        assert (changed.status_code, changed.json['error']) == (400, "Approved interest can't be changed.")
        deleted = client.delete(f'/api/interest/{charged.id}', headers=auth_headers)
        assert (deleted.status_code, deleted.json['error']) == (400, "Approved interest can't be deleted.")

    @pytest.mark.parametrize('body, error', [
        ({}, 'Interest must be a number.'),
        ({'amount': -5}, "Interest can't be negative."),
    ], ids=['missing', 'negative'])
    def test_a_bad_amount_is_a_400(self, client, auth_headers, charged, body, error):
        resp = client.patch(f'/api/interest/{charged.id}', json=body, headers=auth_headers)
        assert (resp.status_code, resp.json) == (400, {'success': False, 'error': error})

    def test_someone_elses_hit_is_not_yours(self, client, auth_headers, charged):
        other = User(username='otheruser', email='other@example.com')
        other.set_password('otherpass')
        _db.session.add(other)
        _db.session.commit()
        theirs = AccountModel(user_id=other.id, acct_id_str='theirs', acct_name='Theirs', kind='loan')
        _db.session.add(theirs)
        _db.session.commit()
        hit = InterestHitModel(account_id=theirs.id, date=date(2026, 12, 1), amount_cents=-100, apr_bps=100,
                               frequency='monthly', base_cents=120000)
        _db.session.add(hit)
        _db.session.commit()
        assert [h['id'] for h in client.get('/api/interest', headers=auth_headers).json['interest']] == [charged.id]
        for resp in (client.patch(f'/api/interest/{hit.id}', json={'amount': 1}, headers=auth_headers),
                     client.post(f'/api/interest/{hit.id}/approve', headers=auth_headers),
                     client.delete(f'/api/interest/{hit.id}', headers=auth_headers)):
            assert (resp.status_code, resp.json['error']) == (403, 'Unauthorized')
        missing = client.patch('/api/interest/999999', json={'amount': 1}, headers=auth_headers)
        assert (missing.status_code, missing.json['error']) == (404, 'Interest not found')


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
        assert [day for day, *_ in hits(loan)] == [date(2026, 12, 1)]
        pin_today(date(2027, 1, 2))                                   # the page loads again a month later
        me = client.get('/api/auth/me', headers={'Authorization': f"Bearer {login.json['access_token']}"})
        assert me.status_code == 200
        assert [day for day, *_ in hits(loan)] == [date(2026, 12, 1), date(2027, 1, 1)]
