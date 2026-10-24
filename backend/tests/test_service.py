"""
Service-layer tests — hit the business logic directly without HTTP.
These are faster and easier to debug than route tests.
"""
import pytest
from datetime import date, timedelta
from flask_jwt_extended import decode_token
from extensions import db as _db
from services.account_service import AccountService
from services.auth_service import AuthService, RegistrationConflict
from services.db_service import DbService

svc = AccountService()
auth_svc = AuthService()
db_svc = DbService()


# ── Accounts ──────────────────────────────────────────────────────────────────

class TestAccountReview:
    def test_new_accounts_do_not_need_attention(self, account):
        assert account.to_dict()['needs_attention'] is False

    @pytest.mark.parametrize('changes', [
        {'account_name': 'Renamed'}, {'account_id': 'new-id'}, {'needs_attention': False},
    ])
    def test_editing_or_marking_reviewed_clears_needs_attention(self, account, changes):
        account.needs_attention = True
        _db.session.commit()
        updated, error = svc.update_account(account.id, changes)
        assert error is None
        assert updated.needs_attention is False

    def test_needs_attention_cannot_be_set_back_to_true(self, account):
        with pytest.raises(ValueError):
            svc.update_account(account.id, {'needs_attention': True})

    def test_columns_fit_long_bank_labels(self):
        # SQLite ignores String lengths, so this guards against Postgres rejecting long import labels
        from models.account import AccountModel
        assert AccountModel.acct_id_str.type.length >= 100
        assert AccountModel.acct_name.type.length >= 100


class TestAccountEditValidation:
    def test_names_and_id_strings_are_trimmed(self, account):
        updated, _ = svc.update_account(account.id, {'account_name': '  Amex Gold ', 'account_id': ' amex-1001  '})
        assert (updated.acct_name, updated.acct_id_str) == ('Amex Gold', 'amex-1001')

    def test_accepts_the_full_column_length(self, account):
        updated, _ = svc.update_account(account.id, {'account_name': 'n' * 100, 'account_id': 'i' * 100})
        assert (len(updated.acct_name), len(updated.acct_id_str)) == (100, 100)

    @pytest.mark.parametrize('field, shown_as', [('account_name', 'Display name'), ('account_id', 'Account ID')])
    @pytest.mark.parametrize('value, problem', [
        ('', "can't be empty."),
        ('   ', "can't be empty."),
        ('x' * 101, 'must be at most 100 characters.'),
        (None, 'must be text.'),
        (1234, 'must be text.'),
    ], ids=['empty', 'blank', 'too-long', 'null', 'number'])
    def test_rejects_invalid_values(self, account, field, shown_as, value, problem):
        with pytest.raises(ValueError, match=f'^{shown_as} {problem}$'):
            svc.update_account(account.id, {field: value})

    def test_a_rejected_edit_changes_nothing(self, account):
        account.needs_attention = True
        _db.session.commit()
        with pytest.raises(ValueError):
            svc.update_account(account.id, {'account_name': 'Valid name', 'account_id': ''})
        assert account.acct_name == 'Test Checking'
        assert account.needs_attention is True


# ── Transaction CRUD ──────────────────────────────────────────────────────────

class TestAddTransaction:
    def test_creates_transaction(self, account):
        tx = svc.add_transaction(account.id, date(2026, 1, 15), 'Netflix', 'Subscriptions', -20.00)
        assert tx.id is not None
        assert tx.vendor == 'Netflix'
        assert tx.amount == pytest.approx(-20.00)

    def test_updates_account_balance(self, account):
        svc.add_transaction(account.id, date(2026, 1, 15), 'Netflix', 'Subscriptions', -20.00)
        assert db_svc.get_account(account.id).balance == pytest.approx(-20.00)

    def test_income_increases_balance(self, account):
        svc.add_transaction(account.id, date(2026, 1, 15), 'Payroll', 'Income', 1000.00)
        assert db_svc.get_account(account.id).balance == pytest.approx(1000.00)


class TestDeleteTransaction:
    def test_removes_transaction(self, account):
        tx = svc.add_transaction(account.id, date(2026, 1, 15), 'Netflix', 'Subscriptions', -20.00)
        tx_id = tx.id
        svc.delete_transaction(tx_id)
        assert db_svc.get_transaction(tx_id) is None

    def test_reverses_balance(self, account):
        tx = svc.add_transaction(account.id, date(2026, 1, 15), 'Netflix', 'Subscriptions', -20.00)
        svc.delete_transaction(tx.id)
        assert db_svc.get_account(account.id).balance == pytest.approx(0.00)


class TestUpdateTransaction:
    def test_changes_amount_and_adjusts_balance(self, account):
        tx = svc.add_transaction(account.id, date(2026, 1, 15), 'Netflix', 'Subscriptions', -20.00)
        svc.update_transaction(tx.id, {'amount': -25.00, 'date': '2026-01-15',
                                        'vendor': 'Netflix', 'category': 'Subscriptions',
                                        'notes': '', 'account_id': account.id})
        assert db_svc.get_account(account.id).balance == pytest.approx(-25.00)

    def test_changes_vendor(self, account):
        tx = svc.add_transaction(account.id, date(2026, 1, 15), 'Netflix', 'Subscriptions', -20.00)
        svc.update_transaction(tx.id, {'vendor': 'Hulu', 'date': '2026-01-15',
                                        'category': 'Subscriptions', 'amount': -20.00,
                                        'notes': '', 'account_id': account.id})
        updated = db_svc.get_transaction(tx.id)
        assert updated.vendor == 'Hulu'


# ── Recurring generation ──────────────────────────────────────────────────────

class TestProcessDueRecurring:
    def _make_recurring(self, account, next_date, number=-1):
        return svc.add_recurring(
            account_id=account.id,
            start_date=next_date,
            vendor='Quizlet',
            category='Subscriptions',
            amount=-20.67,
            next_date=next_date,
            frequency=30,
            number=number,
        )

    def test_generates_transaction_when_due(self, account):
        past = date.today() - timedelta(days=1)
        self._make_recurring(account, past)
        count = svc.process_due_recurring(account.id)
        assert count >= 1

    def test_advances_next_date(self, account):
        past = date.today() - timedelta(days=1)
        rec = self._make_recurring(account, past)
        svc.process_due_recurring(account.id)
        _db.session.refresh(rec)
        assert rec.next_date > date.today()

    def test_respects_occurrence_limit(self, account):
        past = date.today() - timedelta(days=100)
        rec = self._make_recurring(account, past, number=2)
        svc.process_due_recurring(account.id)
        from models.transaction import TransactionModel
        generated = TransactionModel.query.filter_by(recurring_id=rec.id).all()
        assert len(generated) == 2

    def test_does_not_generate_future_transactions(self, account):
        future = date.today() + timedelta(days=10)
        rec = self._make_recurring(account, future)
        count = svc.process_due_recurring(account.id)
        assert count == 0

    def test_generated_transaction_linked_to_recurring(self, account):
        past = date.today() - timedelta(days=1)
        rec = self._make_recurring(account, past)
        svc.process_due_recurring(account.id)
        from models.transaction import TransactionModel
        tx = TransactionModel.query.filter_by(recurring_id=rec.id).first()
        assert tx is not None
        assert tx.vendor == 'Quizlet'
        assert tx.amount == pytest.approx(-20.67)


# ── Delete recurring ──────────────────────────────────────────────────────────

class TestDeleteRecurring:
    def test_delete_keeps_generated_by_default(self, account):
        past = date.today() - timedelta(days=1)
        rec = svc.add_recurring(account.id, past, 'Spotify', 'Subscriptions', -9.99, past, 30)
        svc.process_due_recurring(account.id)
        rec_id = rec.id
        svc.delete_recurring(rec_id, delete_generated=False)
        from models.transaction import TransactionModel
        orphaned = TransactionModel.query.filter_by(recurring_id=None, vendor='Spotify').all()
        assert len(orphaned) >= 1

    def test_delete_removes_generated_when_flagged(self, account):
        past = date.today() - timedelta(days=1)
        rec = svc.add_recurring(account.id, past, 'Spotify', 'Subscriptions', -9.99, past, 30)
        svc.process_due_recurring(account.id)
        rec_id = rec.id
        svc.delete_recurring(rec_id, delete_generated=True)
        from models.transaction import TransactionModel
        remaining = TransactionModel.query.filter_by(vendor='Spotify').all()
        assert len(remaining) == 0


# ── Auth ──────────────────────────────────────────────────────────────────────

class TestPasswordHashing:
    def test_stores_a_hash_not_the_password(self, user):
        assert user.password_hash != 'testpass'
        assert user.verify_password('testpass')
        assert not user.verify_password('wrong')

    def test_hash_fits_the_column(self):
        # SQLite ignores String lengths, so this guards against Postgres rejecting the insert
        from werkzeug.security import generate_password_hash
        from models.user import User
        assert len(generate_password_hash('testpass')) <= User.password_hash.type.length


class TestAuthenticate:
    def test_returns_user_for_correct_password(self, user):
        assert auth_svc.authenticate('testuser', 'testpass').id == user.id

    def test_rejects_wrong_password(self, user):
        assert auth_svc.authenticate('testuser', 'wrong') is None

    def test_rejects_unknown_username(self):
        assert auth_svc.authenticate('nobody', 'testpass') is None

    def test_rejects_non_string_input(self, user):
        assert auth_svc.authenticate('testuser', ['testpass']) is None
        assert auth_svc.authenticate(123, 'testpass') is None   # Postgres rejects int = varchar


class TestRegister:
    def test_trims_input_and_lowercases_email(self):
        created = auth_svc.register('  newuser ', ' New@Example.COM ', 'long-enough')
        assert created.username == 'newuser'
        assert created.email == 'new@example.com'
        assert created.verify_password('long-enough')

    def test_concurrent_duplicate_becomes_conflict(self, user, monkeypatch):
        # Another registration wins the race: the pre-checks see nothing, the unique constraint fires
        from services import auth_service as auth_module
        monkeypatch.setattr(auth_module.db_service, 'get_user_by_username', lambda _: None)
        monkeypatch.setattr(auth_module.db_service, 'get_user_by_email', lambda _: None)

        with pytest.raises(RegistrationConflict):
            auth_svc.register('testuser', 'other@example.com', 'long-enough')
        assert db_svc.get_user_by_id(user.id) is not None   # session still usable after the rollback


class TestIssueToken:
    def test_identity_is_user_id_as_string(self, user):
        claims = decode_token(auth_svc.issue_token(user))
        assert claims['sub'] == str(user.id)
