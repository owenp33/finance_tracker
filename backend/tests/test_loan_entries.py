"""
Loan entries: a recurring series can pay down a loan account (recurring.loan_account_id), and then
every payment in the series has a linked entry on the loan (transactions.loan_payment_id) that
moves what's owed by the opposite amount. The series decides: entries come and go with the
payments in the series, follow their edits, and can't be changed on their own.
"""
from datetime import date

import pytest
from sqlalchemy import func

from extensions import db as _db
from models.account import AccountModel
from models.transaction import TransactionModel
from models.user import User
from services.account_service import AccountService
from services.loan_service import ENTRY_IS_READ_ONLY
from services.recurring_service import RecurringService

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


def entries(loan):
    """The loan's transactions: (date, vendor, category, cents, the payment's id)."""
    rows = TransactionModel.query.filter_by(account_id=loan.id).order_by(TransactionModel.date, TransactionModel.id)
    return [(t.date, t.vendor, t.category, t.amount_cents, t.loan_payment_id) for t in rows]


def balance(account):
    """The stored balance, after checking it's still the starting balance plus the transactions."""
    _db.session.expire(account)
    total = _db.session.query(func.coalesce(func.sum(TransactionModel.amount_cents), 0)) \
        .filter(TransactionModel.account_id == account.id).scalar()
    assert account.balance_cents == account.opening_balance_cents + total
    return account.balance_cents


def pays_down(rec, loan_id):
    return recurring_svc.update_recurring(rec.id, loan_account_id=loan_id)


class TestPayingDownALoan:
    def test_every_payment_in_the_series_gets_an_entry_for_the_opposite_amount(self, account, loan, aspire):
        jan, feb = pay(account, aspire, date(2026, 1, 31)), pay(account, aspire, date(2026, 2, 28), -45.0)
        credit = pay(account, aspire, date(2026, 3, 5), 45.0)            # money back raises what's owed
        pay(account, aspire, date(2026, 3, 31), 0.0)                       # nothing to mirror
        account_svc.add_transaction(account.id, date(2026, 3, 15), 'ASPIRE', 'Loan', -60.0)   # not in the series
        pays_down(aspire, loan.id)
        assert entries(loan) == [
            (date(2026, 1, 31), 'ASPIRE', 'Loan', 7500, jan.id),
            (date(2026, 2, 28), 'ASPIRE', 'Loan', 4500, feb.id),
            (date(2026, 3, 5), 'ASPIRE', 'Loan', -4500, credit.id),
        ]
        assert balance(loan) == 7500
        assert balance(account) == -7500 - 4500 + 4500 - 6000           # the bills stay in Checking
        assert aspire.to_dict()['loan_account_id'] == loan.id

    def test_saving_it_again_changes_nothing(self, account, loan, aspire):
        pay(account, aspire, date(2026, 1, 31))
        pays_down(aspire, loan.id)
        pays_down(aspire, loan.id)
        assert [e[3] for e in entries(loan)] == [7500]
        assert balance(loan) == 7500

    def test_stopping_removes_the_entries(self, account, loan, aspire):
        pay(account, aspire, date(2026, 1, 31))
        pays_down(aspire, loan.id)
        pays_down(aspire, None)
        assert (entries(loan), balance(loan), aspire.to_dict()['loan_account_id']) == ([], 0, None)

    def test_switching_to_another_loan_moves_the_entries(self, user, account, loan, aspire):
        other = AccountModel(user_id=user.id, acct_id_str='mohela-1', acct_name='MOHELA loan', kind='loan')
        _db.session.add(other)
        _db.session.commit()
        jan = pay(account, aspire, date(2026, 1, 31))
        pays_down(aspire, loan.id)
        pays_down(aspire, other.id)
        assert (entries(loan), balance(loan)) == ([], 0)
        assert (entries(other), balance(other)) == ([(date(2026, 1, 31), 'ASPIRE', 'Loan', 7500, jan.id)], 7500)

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


class TestEntriesFollowTheirPayments:
    @pytest.fixture
    def paid(self, account, loan, aspire):
        payment = pay(account, aspire, date(2026, 1, 31))
        pays_down(aspire, loan.id)
        assert entries(loan) == [(date(2026, 1, 31), 'ASPIRE', 'Loan', 7500, payment.id)]
        return payment

    def test_an_edit_to_the_payment_moves_its_entry(self, account, loan, paid):
        _, error = account_svc.update_transaction(paid.id, {'date': '2026-02-02', 'amount': -80, 'vendor': 'Aspire',
                                                            'category': 'Student loan'})
        assert error is None
        assert entries(loan) == [(date(2026, 2, 2), 'Aspire', 'Student loan', 8000, paid.id)]
        assert (balance(loan), balance(account)) == (8000, -8000)

    def test_deleting_the_payment_deletes_its_entry(self, account, loan, paid):
        account_svc.delete_transaction(paid.id)
        assert (entries(loan), balance(loan), balance(account)) == ([], 0, 0)

    def test_an_entry_cant_be_edited_or_deleted_on_its_own(self, loan, paid):
        entry = TransactionModel.query.filter_by(account_id=loan.id).one()
        assert account_svc.update_transaction(entry.id, {'amount': 1}) == (None, ENTRY_IS_READ_ONLY)
        assert account_svc.delete_transaction(entry.id) == (False, ENTRY_IS_READ_ONLY)
        assert (entries(loan), balance(loan)) == ([(date(2026, 1, 31), 'ASPIRE', 'Loan', 7500, paid.id)], 7500)

    def test_renaming_the_series_renames_the_entries(self, loan, aspire, paid):
        recurring_svc.update_recurring(aspire.id, vendor='Aspire Loan', category='Student loan')
        assert entries(loan) == [(date(2026, 1, 31), 'Aspire Loan', 'Student loan', 7500, paid.id)]

    def test_an_import_replacing_the_payment_moves_its_entry(self, loan, paid):
        recurring_svc.replace_occurrence(paid.id, date(2026, 2, 1), -7600)
        assert (entries(loan), balance(loan)) == ([(date(2026, 2, 1), 'ASPIRE', 'Loan', 7600, paid.id)], 7600)

    @pytest.mark.parametrize('delete_generated', [True, False], ids=['with-its-payments', 'keeping-its-payments'])
    def test_deleting_the_series_removes_the_entries(self, account, loan, aspire, paid, delete_generated):
        recurring_svc.delete_recurring(aspire.id, delete_generated=delete_generated)
        assert (entries(loan), balance(loan)) == ([], 0)
        assert balance(account) == (0 if delete_generated else -7500)

    def test_deleting_the_paying_account_removes_the_entries(self, account, loan, paid):
        account_svc.delete_account(account.id)
        assert (entries(loan), balance(loan)) == ([], 0)

    def test_deleting_the_loan_stops_the_series_paying_it_down(self, loan, aspire, paid):
        account_svc.delete_account(loan.id)
        assert _db.session.get(TransactionModel, paid.id) is not None
        assert aspire.loan_account_id is None


class TestPaymentsJoiningAndLeavingTheSeries:
    def test_a_generated_payment_gets_its_entry(self, account, loan, pin_today):
        rec = recurring_svc.add_recurring(account.id, date(2026, 1, 31), 'ASPIRE', 'Loan', -75.0,
                                          next_date=date(2026, 1, 31), frequency=1, frequency_unit='months')
        pays_down(rec, loan.id)
        pin_today(date(2026, 2, 28))
        assert recurring_svc.process_due_recurring(account.id) == 2
        generated = TransactionModel.query.filter_by(recurring_id=rec.id).order_by(TransactionModel.date).all()
        assert entries(loan) == [(date(2026, 1, 31), 'ASPIRE', 'Loan', 7500, generated[0].id),
                                 (date(2026, 2, 28), 'ASPIRE', 'Loan', 7500, generated[1].id)]
        assert balance(loan) == 15000

    def test_a_payment_the_series_adopts_gets_its_entry(self, account, loan, pin_today):
        imported = account_svc.add_transaction(account.id, date(2026, 2, 1), 'ASPIRE', 'Loan', -75.0)
        rec = recurring_svc.add_recurring(account.id, date(2026, 1, 31), 'ASPIRE', 'Loan', -75.0,
                                          next_date=date(2026, 1, 31), frequency=1, frequency_unit='months')
        pays_down(rec, loan.id)
        pin_today(date(2026, 2, 5))
        assert recurring_svc.process_due_recurring(account.id) == 0      # the bank's row stands in for it
        assert entries(loan) == [(date(2026, 2, 1), 'ASPIRE', 'Loan', 7500, imported.id)]

    def test_linking_a_payment_gives_it_an_entry_and_unlinking_takes_it_away(self, account, loan, aspire):
        pays_down(aspire, loan.id)
        extra = account_svc.add_transaction(account.id, date(2026, 6, 3), 'ASPIRE', 'Loan', -30.0)
        recurring_svc.link_transaction(aspire.id, extra.id)
        assert (entries(loan), balance(loan)) == ([(date(2026, 6, 3), 'ASPIRE', 'Loan', 3000, extra.id)], 3000)
        recurring_svc.unlink_transaction(aspire.id, extra.id)
        assert (entries(loan), balance(loan)) == ([], 0)


class TestLoanEntryRoutes:
    @pytest.fixture
    def entry(self, account, loan, aspire):
        pay(account, aspire, date(2026, 1, 31))
        pays_down(aspire, loan.id)
        return TransactionModel.query.filter_by(account_id=loan.id).one()

    def test_setting_pays_down_returns_it(self, client, auth_headers, account, loan, aspire):
        pay(account, aspire, date(2026, 1, 31))
        resp = client.patch(f'/api/recurring/{aspire.id}', json={'loan_account_id': loan.id}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json['recurring']['loan_account_id'] == loan.id
        listed = client.get('/api/accounts/all-transactions', headers=auth_headers).json['transactions']
        payment = next(t for t in listed if not t['on_loan_account'])
        assert [(t['amount_cents'], t['loan_payment_id']) for t in listed if t['on_loan_account']] == [(7500, payment['id'])]
        assert payment['loan_payment_id'] is None

    def test_an_invalid_pays_down_is_a_400(self, client, auth_headers, account, aspire):
        resp = client.patch(f'/api/recurring/{aspire.id}', json={'loan_account_id': account.id}, headers=auth_headers)
        assert (resp.status_code, resp.json) == (400, {'success': False, 'error': 'Pays down must be one of your loan accounts.'})

    def test_an_entry_cant_be_edited_deleted_or_made_a_transfer(self, client, auth_headers, account, entry):
        for resp in (
            client.patch(f'/api/transactions/{entry.id}', json={'amount': 1}, headers=auth_headers),
            client.delete(f'/api/transactions/{entry.id}', headers=auth_headers),
            client.patch(f'/api/transactions/{entry.id}/transfer', headers=auth_headers),
            client.post(f'/api/transactions/{entry.id}/transfer/pair', json={'to_account_id': account.id},
                        headers=auth_headers),
        ):
            assert (resp.status_code, resp.json) == (400, {'success': False, 'error': ENTRY_IS_READ_ONLY})
        assert _db.session.get(TransactionModel, entry.id).amount_cents == 7500
