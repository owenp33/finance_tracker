"""
Service-layer tests — hit the business logic directly without HTTP.
These are faster and easier to debug than route tests.
"""
import pytest
from datetime import date, timedelta
from extensions import db as _db
from services.account_service import AccountService
from services.db_service import DbService

svc = AccountService()
db_svc = DbService()


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
