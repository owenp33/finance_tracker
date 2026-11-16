"""
Updating a loan from a statement: the statement's date and balance (negative when owed, like the
account's) book the difference from the app's balance at the end of that day as a "Statement
adjustment" on that date (interest, fees, anything the app doesn't know about).
"""
import re
from datetime import date

import pytest
from sqlalchemy import func

from extensions import db as _db
from models.account import AccountModel
from models.transaction import TransactionModel
from services.account_service import AccountService

account_svc = AccountService()


@pytest.fixture
def loan(user):
    """A loan owing $20,000.00 before its first payment, then $75 paid on Jan 31 and Feb 28."""
    a = AccountModel(user_id=user.id, acct_id_str='aspire-1', acct_name='ASPIRE loan', kind='loan',
                     opening_balance_cents=-2_000_000, balance_cents=-2_000_000)
    _db.session.add(a)
    _db.session.commit()
    for day in (date(2026, 1, 31), date(2026, 2, 28)):
        account_svc.add_transaction(a.id, day, 'ASPIRE', 'Loan', 75.0)
    return a


def ledger(loan):
    """The loan's transactions: (date, vendor, category, cents, notes)."""
    rows = TransactionModel.query.filter_by(account_id=loan.id).order_by(TransactionModel.date, TransactionModel.id)
    return [(t.date, t.vendor, t.category, t.amount_cents, t.notes) for t in rows]


def balance(account):
    """The stored balance, after checking it's still the starting balance plus the transactions."""
    _db.session.expire(account)
    total = _db.session.query(func.coalesce(func.sum(TransactionModel.amount_cents), 0)) \
        .filter(TransactionModel.account_id == account.id).scalar()
    assert account.balance_cents == account.opening_balance_cents + total
    return account.balance_cents


def statement(loan, day, dollars):
    return account_svc.update_from_statement(loan.id, {'date': day, 'balance': dollars})


class TestUpdateFromStatement:
    def test_the_difference_is_booked_on_the_statement_date(self, loan):
        # The app has -$19,850.00 at the end of Feb 28; the statement says -$19,900.00: $50 of interest
        adjustment = statement(loan, '2026-02-28', -19_900.00)
        assert (adjustment.date, adjustment.amount_cents) == (date(2026, 2, 28), -5_000)
        assert ledger(loan)[-1] == (date(2026, 2, 28), 'Statement adjustment', 'Statement adjustment', -5_000,
                                    'Statement balance -$19,900.00')
        assert balance(loan) == -1_990_000

    def test_later_transactions_are_not_part_of_the_statement(self, loan):
        account_svc.add_transaction(loan.id, date(2026, 3, 31), 'ASPIRE', 'Loan', 75.0)
        assert statement(loan, '2026-02-28', -19_900.00).amount_cents == -5_000
        assert balance(loan) == -1_990_000 + 7_500

    def test_a_statement_before_the_first_transaction_counts_from_the_starting_balance(self, loan):
        adjustment = statement(loan, '2026-01-01', -20_100.00)
        assert (adjustment.date, adjustment.amount_cents) == (date(2026, 1, 1), -10_000)

    def test_statements_build_on_each_other(self, loan):
        statement(loan, '2026-01-31', -19_960.00)                       # -$19,925.00 in the app: $35
        assert statement(loan, '2026-02-28', -19_920.00).amount_cents == -3_500   # -$19,885.00 with the first
        assert [row[3] for row in ledger(loan)] == [7_500, -3_500, 7_500, -3_500]
        assert balance(loan) == -1_992_000

    def test_less_owed_than_the_app_thinks_is_a_positive_adjustment(self, loan):
        assert statement(loan, '2026-02-28', -19_800.00).amount_cents == 5_000

    def test_a_statement_that_matches_books_nothing(self, loan):
        assert statement(loan, '2026-02-28', -19_850.00) is None
        assert len(ledger(loan)) == 2

    @pytest.mark.parametrize('data, error', [
        ({'date': '2026-02-28'}, 'Statement balance must be a number.'),
        ({'date': '2026-02-28', 'balance': 'lots'}, 'Statement balance must be a number.'),
        ({'date': '2026-02-28', 'balance': -10_000_000.01},
         'Statement balance must be between -$10,000,000 and $10,000,000.'),
        ({'balance': -19_900}, 'Statement date must be a date (YYYY-MM-DD).'),
        ({'date': 'Feb 28', 'balance': -19_900}, 'Statement date must be a date (YYYY-MM-DD).'),
        ({'date': 20260228, 'balance': -19_900}, 'Statement date must be a date (YYYY-MM-DD).'),
        ({'date': '2099-01-01', 'balance': -19_900}, "Statement date can't be in the future."),
    ], ids=['no-balance', 'text-balance', 'balance-too-low', 'no-date', 'unreadable-date', 'number-date', 'future'])
    def test_rejects_invalid_statements(self, loan, data, error):
        with pytest.raises(ValueError, match=f'^{re.escape(error)}$'):
            account_svc.update_from_statement(loan.id, data)
        assert (len(ledger(loan)), balance(loan)) == (2, -1_985_000)

    def test_only_a_loan_takes_a_statement(self, account):
        with pytest.raises(ValueError, match=r'^Only a loan account can be updated from a statement\.$'):
            account_svc.update_from_statement(account.id, {'date': '2026-02-28', 'balance': 100})


class TestStatementRoute:
    def test_returns_the_account_and_the_adjustment(self, client, auth_headers, loan):
        resp = client.post(f'/api/accounts/{loan.id}/statement', json={'date': '2026-02-28', 'balance': -19_900},
                           headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json['account']['balance'] == -19_900.0
        adjustment = resp.json['adjustment']
        assert (adjustment['date'], adjustment['vendor'], adjustment['amount_cents'], adjustment['on_loan_account']) \
            == ('2026-02-28', 'Statement adjustment', -5_000, True)

    def test_a_matching_statement_has_no_adjustment(self, client, auth_headers, loan):
        resp = client.post(f'/api/accounts/{loan.id}/statement', json={'date': '2026-02-28', 'balance': -19_850},
                           headers=auth_headers)
        assert (resp.status_code, resp.json['adjustment'], resp.json['account']['balance']) == (200, None, -19_850.0)

    def test_an_invalid_statement_is_a_400(self, client, auth_headers, loan):
        resp = client.post(f'/api/accounts/{loan.id}/statement', json={'date': '2099-01-01', 'balance': -19_900},
                           headers=auth_headers)
        assert (resp.status_code, resp.json) == (400, {'success': False, 'error': "Statement date can't be in the future."})

    def test_requires_login(self, client, loan):
        assert client.post(f'/api/accounts/{loan.id}/statement', json={}).status_code == 401
