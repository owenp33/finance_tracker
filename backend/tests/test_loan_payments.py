"""
Loan payments: a recurring series can pay down a loan account (recurring.loan_account_id), and then
every payment in the series also counts on the loan for the opposite amount (a $75 bill in Checking
is $75 less owed), with nothing booked on the loan. The loan's balance is its starting balance plus
its own transactions less those payments; it follows the payments as they're added, edited,
replaced or deleted, and as they join or leave the series; and its history lists them.
"""
import csv
import io
from datetime import date

import pytest
from sqlalchemy import func

from extensions import db as _db
from models.account import AccountModel
from models.interest_hit import InterestHitModel
from models.recurring import RecurringModel
from models.transaction import TransactionModel
from models.user import User
from services.account_service import AccountService
from services.analytics_service import AnalyticsService
from services.balance_service import BalanceService
from services.interest_service import InterestService
from services.recurring_service import RecurringService
from services.reports import pdf_pages

account_svc = AccountService()
recurring_svc = RecurringService()


@pytest.fixture
def loan(user):
    a = AccountModel(user_id=user.id, acct_id_str='aspire-1', acct_name='ASPIRE loan', kind='loan')
    _db.session.add(a)
    _db.session.commit()
    return a


@pytest.fixture
def aspire(account):
    """ASPIRE's monthly series on Checking, its next payment far off so nothing generates by itself."""
    return recurring_svc.add_recurring(account.id, date(2026, 1, 31), 'ASPIRE', 'Loan', -75.0,
                                       next_date=date(2099, 1, 31), frequency=1, frequency_unit='months')


def pay(account, rec, day, dollars=-75.0, vendor='ASPIRE'):
    """A payment in the series (recurring_id set, as generation leaves it)."""
    return account_svc.add_transaction(account.id, day, vendor, 'Loan', dollars, recurring_id=rec.id)


def balance(account):
    """
    The stored balance, after checking it's still the starting balance plus the account's own
    transactions less the payments of the series that pay it down.
    """
    _db.session.expire(account)
    own = _db.session.query(func.coalesce(func.sum(TransactionModel.amount_cents), 0)) \
        .filter(TransactionModel.account_id == account.id).scalar()
    paid = _db.session.query(func.coalesce(func.sum(TransactionModel.amount_cents), 0)) \
        .join(RecurringModel, TransactionModel.recurring_id == RecurringModel.id) \
        .filter(RecurringModel.loan_account_id == account.id).scalar()
    assert account.balance_cents == account.opening_balance_cents + own - paid
    return account.balance_cents


def booked_on(loan):
    """How many transactions are booked on the loan itself."""
    return TransactionModel.query.filter_by(account_id=loan.id).count()


def history(user, loan, **period):
    """The loan's ledger rows: (date, vendor, cents on the loan, a payment from elsewhere?, balance after)."""
    [ledger] = BalanceService().ledgers(user.id, [loan.id], **period)
    return [(r.transaction.date, r.transaction.vendor, r.amount_cents, r.loan_payment, r.balance_cents) for r in ledger.rows]


def pays_down(rec, loan_id):
    return recurring_svc.update_recurring(rec.id, loan_account_id=loan_id)


class TestPayingDownALoan:
    def test_every_payment_in_the_series_counts_on_the_loan_for_the_opposite_amount(self, user, account, loan, aspire):
        pay(account, aspire, date(2026, 1, 31))
        pay(account, aspire, date(2026, 2, 28), -45.0)
        pay(account, aspire, date(2026, 3, 5), 45.0)                       # money back raises what's owed
        pay(account, aspire, date(2026, 3, 31), 0.0)                       # moves nothing, so not listed
        account_svc.add_transaction(account.id, date(2026, 3, 15), 'ASPIRE', 'Loan', -60.0)   # not in the series
        pays_down(aspire, loan.id)
        assert balance(loan) == 7500
        assert booked_on(loan) == 0
        assert history(user, loan) == [
            (date(2026, 1, 31), 'ASPIRE', 7500, True, 7500),
            (date(2026, 2, 28), 'ASPIRE', 4500, True, 12000),
            (date(2026, 3, 5), 'ASPIRE', -4500, True, 7500),
        ]
        assert balance(account) == -7500 - 4500 + 4500 - 6000           # the bills stay in Checking
        assert aspire.to_dict()['loan_account_id'] == loan.id

    def test_saving_it_again_changes_nothing(self, account, loan, aspire):
        pay(account, aspire, date(2026, 1, 31))
        pays_down(aspire, loan.id)
        pays_down(aspire, loan.id)
        assert balance(loan) == 7500

    def test_stopping_takes_the_payments_off_the_loan(self, user, account, loan, aspire):
        pay(account, aspire, date(2026, 1, 31))
        pays_down(aspire, loan.id)
        pays_down(aspire, None)
        assert (balance(loan), history(user, loan), aspire.to_dict()['loan_account_id']) == (0, [], None)

    def test_switching_to_another_loan_moves_the_payments(self, user, account, loan, aspire):
        other = AccountModel(user_id=user.id, acct_id_str='mohela-1', acct_name='MOHELA loan', kind='loan')
        _db.session.add(other)
        _db.session.commit()
        pay(account, aspire, date(2026, 1, 31))
        pays_down(aspire, loan.id)
        pays_down(aspire, other.id)
        assert (balance(loan), balance(other)) == (0, 7500)
        assert history(user, other) == [(date(2026, 1, 31), 'ASPIRE', 7500, True, 7500)]

    @pytest.fixture
    def strangers_loan(self):
        u = User(username='otheruser', email='other@example.com')
        u.set_password('otherpass')
        _db.session.add(u)
        _db.session.commit()
        a = AccountModel(user_id=u.id, acct_id_str='their-loan', acct_name='Their loan', kind='loan')
        _db.session.add(a)
        _db.session.commit()
        return a

    @pytest.mark.parametrize('pick', ['bank', 'stranger', 'missing', 'text', 'bool'])
    def test_it_must_be_one_of_your_loan_accounts(self, account, aspire, strangers_loan, pick):
        value = {'bank': account.id, 'stranger': strangers_loan.id, 'missing': 99_999,
                 'text': str(account.id), 'bool': True}[pick]
        with pytest.raises(ValueError, match=r'^Pays down must be one of your loan accounts\.$'):
            recurring_svc.update_recurring(aspire.id, loan_account_id=value, vendor='Renamed')
        assert (aspire.vendor, aspire.loan_account_id) == ('ASPIRE', None)

    def test_a_series_cant_pay_down_the_account_its_paid_from(self, account, aspire):
        account.kind = 'loan'
        _db.session.commit()
        with pytest.raises(ValueError, match=r"^A series can't pay down the account it's paid from\.$"):
            pays_down(aspire, account.id)

    def test_a_loan_a_series_pays_down_has_to_stay_a_loan(self, loan, aspire):
        pays_down(aspire, loan.id)
        with pytest.raises(ValueError, match=r"^ASPIRE pays down this loan; choose another account for it first\.$"):
            account_svc.update_account(loan.id, {'kind': 'bank'})
        assert loan.kind == 'loan'


class TestTheLoanFollowsItsPayments:
    @pytest.fixture
    def paid(self, account, loan, aspire):
        payment = pay(account, aspire, date(2026, 1, 31))
        pays_down(aspire, loan.id)
        assert balance(loan) == 7500
        return payment

    def test_an_edit_to_the_payment_moves_the_loan(self, user, account, loan, paid):
        _, error = account_svc.update_transaction(paid.id, {'date': '2026-02-02', 'amount': -80, 'vendor': 'Aspire'})
        assert error is None
        assert (balance(loan), balance(account)) == (8000, -8000)
        assert history(user, loan) == [(date(2026, 2, 2), 'Aspire', 8000, True, 8000)]

    def test_deleting_the_payment_takes_it_off_the_loan(self, account, loan, paid):
        account_svc.delete_transaction(paid.id)
        assert (balance(loan), balance(account)) == (0, 0)

    def test_an_import_replacing_the_payment_moves_the_loan(self, loan, paid):
        recurring_svc.replace_occurrence(paid.id, date(2026, 2, 1), -7600)
        assert balance(loan) == 7600

    @pytest.mark.parametrize('delete_generated', [True, False], ids=['with-its-payments', 'keeping-its-payments'])
    def test_deleting_the_series_takes_its_payments_off_the_loan(self, account, loan, aspire, paid, delete_generated):
        recurring_svc.delete_recurring(aspire.id, delete_generated=delete_generated)
        assert balance(loan) == 0
        assert balance(account) == (0 if delete_generated else -7500)

    def test_deleting_the_paying_account_takes_its_payments_off_the_loan(self, account, loan, paid):
        account_svc.delete_account(account.id)
        assert balance(loan) == 0

    def test_deleting_the_loan_stops_the_series_paying_it_down(self, loan, aspire, paid):
        account_svc.delete_account(loan.id)
        assert _db.session.get(TransactionModel, paid.id) is not None
        assert aspire.loan_account_id is None

    def test_a_current_balance_edit_counts_the_payments(self, loan, paid):
        account_svc.update_account(loan.id, {'balance': -1000})
        assert (balance(loan), loan.opening_balance_cents) == (-100000, -100000 - 7500)
        assert account_svc.recalculate_account_balance(loan.id) == -1000.0


class TestPaymentsJoiningAndLeavingTheSeries:
    def test_generated_payments_count_on_the_loan(self, account, loan, pin_today):
        rec = recurring_svc.add_recurring(account.id, date(2026, 1, 31), 'ASPIRE', 'Loan', -75.0,
                                          next_date=date(2026, 1, 31), frequency=1, frequency_unit='months')
        pays_down(rec, loan.id)
        pin_today(date(2026, 2, 28))
        assert recurring_svc.process_due_recurring(account.id) == 2
        assert (balance(loan), booked_on(loan)) == (15000, 0)

    def test_a_payment_the_series_adopts_counts_on_the_loan(self, account, loan, pin_today):
        account_svc.add_transaction(account.id, date(2026, 2, 1), 'ASPIRE', 'Loan', -75.0)
        rec = recurring_svc.add_recurring(account.id, date(2026, 1, 31), 'ASPIRE', 'Loan', -75.0,
                                          next_date=date(2026, 1, 31), frequency=1, frequency_unit='months')
        pays_down(rec, loan.id)
        pin_today(date(2026, 2, 5))
        assert recurring_svc.process_due_recurring(account.id) == 0      # the bank's row stands in for it
        assert balance(loan) == 7500

    def test_linking_a_payment_counts_it_and_unlinking_takes_it_off(self, account, loan, aspire):
        pays_down(aspire, loan.id)
        extra = account_svc.add_transaction(account.id, date(2026, 6, 3), 'ASPIRE', 'Loan', -30.0)
        recurring_svc.link_transaction(aspire.id, extra.id)
        assert balance(loan) == 3000
        recurring_svc.unlink_transaction(aspire.id, extra.id)
        assert balance(loan) == 0


class TestTheLoansHistory:
    @pytest.fixture
    def paid(self, account, loan, aspire):
        """Owed $1,000 from the start; $75 paid Jan 31 and Feb 28; $10 of interest booked on Mar 1."""
        account_svc.update_account(loan.id, {'opening_balance': -1000})
        for day in (date(2026, 1, 31), date(2026, 2, 28)):
            pay(account, aspire, day)
        pays_down(aspire, loan.id)
        account_svc.add_transaction(loan.id, date(2026, 3, 1), 'Interest', 'Interest', -10.0)
        assert balance(loan) == -100000 + 15000 - 1000

    def test_a_period_starts_from_the_payments_before_it(self, user, loan, paid):
        assert history(user, loan, start_date=date(2026, 2, 1)) == [
            (date(2026, 2, 28), 'ASPIRE', 7500, True, -92500 + 7500),
            (date(2026, 3, 1), 'Interest', -1000, False, -86000),
        ]

    def test_the_balance_history_steps_on_each_payment_and_ends_at_the_balance(self, client, auth_headers, loan, paid):
        resp = client.get(f'/api/balances?account_ids={loan.id}', headers=auth_headers)
        [entry] = resp.json['balances']
        assert [(d['date'], d['balance_cents']) for d in entry['days']] == [
            ('2026-01-31', -92500), ('2026-02-28', -85000), ('2026-03-01', -86000)]
        assert entry['closing_cents'] == balance(loan)

    def test_interest_is_charged_on_what_is_owed_after_the_payments(self, loan, paid):
        loan.apr_bps, loan.interest_frequency, loan.interest_through = 1200, 'monthly', date(2026, 3, 1)
        _db.session.commit()
        InterestService().accrue(loan.id, today=date(2026, 4, 2))
        # Owed on Mar 31: $1,000 - $150 + $10 = $860; 12% / 12 of it is $8.60
        assert InterestHitModel.query.filter_by(account_id=loan.id, date=date(2026, 4, 1)).one().amount_cents == -860

    def test_the_csv_lists_each_payment_once_in_its_own_account(self, client, auth_headers, account, loan, paid):
        # Transactions only, so it imports again cleanly; the loan's running balance counts the payments
        resp = client.get('/api/export/transactions.csv', headers=auth_headers)
        rows = list(csv.reader(io.StringIO(resp.get_data(as_text=True))))
        assert rows[1:] == [
            ['Test Checking', '2026-01-31', 'ASPIRE', 'Loan', '', '', '75.00', '-75.00'],
            ['Test Checking', '2026-02-28', 'ASPIRE', 'Loan', '', '', '75.00', '-150.00'],
            ['ASPIRE loan', '2026-03-01', 'Interest', 'Interest', '', '', '10.00', '-860.00'],
        ]

    def test_the_pdf_shows_them_on_the_loans_page_and_counts_them_once(self, client, auth_headers, monkeypatch,
                                                                         user, loan, paid):
        summarised, pages = [], {}
        real_report, real_pages = AnalyticsService.generate_report, pdf_pages.render_account_pages
        monkeypatch.setattr(AnalyticsService, 'generate_report',
                            staticmethod(lambda txs: summarised.append(sorted((t.vendor, t.amount_cents) for t in txs))
                                         or real_report(txs)))

        def account_pages(pdf, ledger, *args):
            pages[ledger.account.acct_name] = [(r.amount_cents, r.balance_cents) for r in ledger.rows]
            return real_pages(pdf, ledger, *args)
        monkeypatch.setattr(pdf_pages, 'render_account_pages', account_pages)
        assert client.get('/api/export/report.pdf', headers=auth_headers).status_code == 200
        assert summarised == [[('ASPIRE', -7500), ('ASPIRE', -7500), ('Interest', -1000)]]   # each payment once
        assert pages['ASPIRE loan'] == [(7500, -92500), (7500, -85000), (-1000, -86000)]
        # The loan's table: its amounts; a payment over budget is flagged on its own account's page only
        [ledger] = BalanceService().ledgers(user.id, [loan.id])
        table = pdf_pages.account_table_rows(ledger.rows, {ledger.rows[0].transaction.id})
        assert [(cells[3], cells[5], over) for cells, over in table] == [
            ('$75.00', '', False), ('$75.00', '', False), ('-$10.00', '', False)]


class TestLoanRoutes:
    def test_setting_pays_down_returns_it_and_books_nothing_on_the_loan(self, client, auth_headers, account, loan, aspire):
        pay(account, aspire, date(2026, 1, 31))
        resp = client.patch(f'/api/recurring/{aspire.id}', json={'loan_account_id': loan.id}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json['recurring']['loan_account_id'] == loan.id
        [payment] = client.get('/api/accounts/all-transactions', headers=auth_headers).json['transactions']
        assert (payment['account_id'], payment['amount_cents'], payment['on_loan_account']) == (account.id, -7500, False)
        assert 'loan_payment_id' not in payment
        accounts = {a['id']: a for a in client.get('/api/accounts', headers=auth_headers).json['accounts']}
        assert accounts[loan.id]['balance'] == 75.0

    def test_an_invalid_pays_down_is_a_400(self, client, auth_headers, account, aspire):
        resp = client.patch(f'/api/recurring/{aspire.id}', json={'loan_account_id': account.id}, headers=auth_headers)
        assert (resp.status_code, resp.json) == (400, {'success': False, 'error': 'Pays down must be one of your loan accounts.'})
