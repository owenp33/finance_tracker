"""
Service-layer tests — hit the business logic directly without HTTP.
These are faster and easier to debug than route tests.
"""
import re
import pytest
from datetime import date, timedelta
from flask_jwt_extended import decode_token
from sqlalchemy import text
from extensions import db as _db
from models.account import AccountModel
from services.account_service import AccountService
from services.recurring_service import RecurringService
from services.auth_service import AuthService, RegistrationConflict
from services.budget_service import BudgetService
from services.budget_flag_service import BudgetFlagService
from services.db_service import DbService

svc = AccountService()
recurring_svc = RecurringService()
auth_svc = AuthService()
db_svc = DbService()


# ── Accounts ──────────────────────────────────────────────────────────────────

class TestAccountReview:
    def test_new_accounts_do_not_need_attention(self, account):
        assert account.to_dict()['needs_attention'] is False

    @pytest.mark.parametrize('changes', [
        {'account_name': 'Renamed'}, {'account_id': 'new-id'}, {'needs_attention': False},
        {'opening_balance': 250},
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


class TestStartingBalance:
    def test_new_accounts_start_at_zero(self, account):
        assert account.to_dict()['opening_balance'] == 0

    def test_setting_it_shifts_the_balance_by_the_difference(self, account):
        svc.add_transaction(account.id, date(2026, 1, 15), 'Grocer', 'Groceries', -20.00)
        svc.update_account(account.id, {'opening_balance': 1000})
        assert (account.opening_balance, account.balance) == (1000, 980)
        svc.update_account(account.id, {'opening_balance': -815.07})
        assert (account.opening_balance, account.balance) == (-815.07, pytest.approx(-835.07))

    def test_recalculating_includes_it(self, account):
        svc.update_account(account.id, {'opening_balance': 100})
        svc.add_transaction(account.id, date(2026, 1, 15), 'Grocer', 'Groceries', -20.00)
        account.balance_cents = 0   # out of sync, as recalculation exists to fix
        _db.session.commit()
        assert svc.recalculate_account_balance(account.id) == 80
        assert account.balance_cents == 8000

    @pytest.mark.parametrize('value, error', [
        ('1000', 'Starting balance must be a number.'),
        (None, 'Starting balance must be a number.'),
        (True, 'Starting balance must be a number.'),
        (float('nan'), 'Starting balance must be a number.'),
        (float('inf'), 'Starting balance must be a number.'),
        (10_000_000.01, 'Starting balance must be between -$10,000,000 and $10,000,000.'),
        (-10_000_000.01, 'Starting balance must be between -$10,000,000 and $10,000,000.'),
    ], ids=['string', 'null', 'bool', 'nan', 'inf', 'too-high', 'too-low'])
    def test_rejects_invalid_values(self, account, value, error):
        with pytest.raises(ValueError, match=f'^{re.escape(error)}$'):
            svc.update_account(account.id, {'opening_balance': value})

    def test_accepts_the_limits(self, account):
        svc.update_account(account.id, {'opening_balance': 10_000_000})
        svc.update_account(account.id, {'opening_balance': -10_000_000})
        assert account.opening_balance_cents == -1_000_000_000

    def test_a_rejected_edit_changes_nothing(self, account):
        svc.update_account(account.id, {'opening_balance': 50})
        with pytest.raises(ValueError):
            svc.update_account(account.id, {'opening_balance': 75, 'account_name': ''})
        assert (account.opening_balance, account.balance) == (50, 50)


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


class TestBalancesUnderConcurrentRequests:
    """
    Two requests changing one account at the same moment must not overwrite each other's balance
    change. Each test loads the account, then applies "another request's" change straight in SQL
    (the loaded account doesn't see it), then runs the operation: a read, add and write in Python
    would lose the other change; an atomic SQL increment keeps both.
    """

    def _another_request_adds(self, account, cents):
        db_svc.get_account(account.id).balance_cents   # loaded now, and about to be out of date
        _db.session.execute(text('UPDATE accounts SET balance_cents = balance_cents + :c WHERE id = :id'),
                            {'c': cents, 'id': account.id})

    def _stored(self, account):
        return _db.session.execute(text('SELECT balance_cents FROM accounts WHERE id = :id'), {'id': account.id}).scalar()

    def test_adding_a_transaction(self, account):
        self._another_request_adds(account, 500)
        svc.add_transaction(account.id, date(2026, 1, 15), 'Netflix', 'Subscriptions', -20.00)
        assert self._stored(account) == 500 - 2000
        assert db_svc.get_account(account.id).balance_cents == 500 - 2000   # the loaded account re-reads it

    def test_deleting_a_transaction(self, account):
        tx = svc.add_transaction(account.id, date(2026, 1, 15), 'Netflix', 'Subscriptions', -20.00)
        self._another_request_adds(account, 500)
        svc.delete_transaction(tx.id)
        assert self._stored(account) == 500

    def test_changing_an_amount(self, account):
        tx = svc.add_transaction(account.id, date(2026, 1, 15), 'Netflix', 'Subscriptions', -20.00)
        self._another_request_adds(account, 500)
        svc.update_transaction(tx.id, {'amount': -25.00})
        assert self._stored(account) == -2000 + 500 - 500

    def test_moving_a_transaction_to_another_account(self, account):
        other = AccountModel(user_id=account.user_id, acct_id_str='sav-1', acct_name='Savings')
        _db.session.add(other)
        _db.session.commit()
        tx = svc.add_transaction(account.id, date(2026, 1, 15), 'Netflix', 'Subscriptions', -20.00)
        self._another_request_adds(account, 500)
        self._another_request_adds(other, 700)
        svc.update_transaction(tx.id, {'account_id': other.id})
        assert (self._stored(account), self._stored(other)) == (500, 700 - 2000)

    def test_changing_the_starting_balance(self, account):
        self._another_request_adds(account, 500)
        svc.update_account(account.id, {'opening_balance': 100})
        assert self._stored(account) == 500 + 10_000

    def test_pairing_a_transfer(self, account):
        other = AccountModel(user_id=account.user_id, acct_id_str='sav-1', acct_name='Savings')
        _db.session.add(other)
        _db.session.commit()
        tx = svc.add_transaction(account.id, date(2026, 1, 15), 'To savings', 'Transfer', -100.00, is_transfer=True)
        self._another_request_adds(other, 700)
        svc.create_transfer_pair(tx.id, other.id)
        assert self._stored(other) == 700 + 10_000

    def test_deleting_a_template_with_its_transactions(self, account, pin_today):
        pin_today(date(2026, 1, 20))
        rec = recurring_svc.add_recurring(account.id, date(2026, 1, 15), 'Gym', 'Fitness', -30.0, date(2026, 1, 15), 1,
                                          frequency_unit='months')
        recurring_svc.process_due_recurring(account.id)
        self._another_request_adds(account, 500)
        recurring_svc.delete_recurring(rec.id, delete_generated=True)
        assert self._stored(account) == 500

    def test_recalculating_counts_every_transaction_in_the_database(self, account):
        svc.add_transaction(account.id, date(2026, 1, 15), 'Netflix', 'Subscriptions', -20.00)
        db_svc.get_account(account.id).transactions   # loaded now, and about to be out of date
        _db.session.execute(text(
            "INSERT INTO transactions (account_id, date, vendor, category, amount_cents, is_transfer, is_reimbursement) "
            "VALUES (:id, '2026-01-16', 'Other request', 'Misc', -500, 0, 0)"), {'id': account.id})
        assert svc.recalculate_account_balance(account.id) == pytest.approx(-25.00)
        assert self._stored(account) == -2500


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
        return recurring_svc.add_recurring(
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
        count = recurring_svc.process_due_recurring(account.id)
        assert count >= 1

    def test_advances_next_date(self, account):
        past = date.today() - timedelta(days=1)
        rec = self._make_recurring(account, past)
        recurring_svc.process_due_recurring(account.id)
        _db.session.refresh(rec)
        assert rec.next_date > date.today()

    def test_respects_occurrence_limit(self, account):
        past = date.today() - timedelta(days=100)
        rec = self._make_recurring(account, past, number=2)
        recurring_svc.process_due_recurring(account.id)
        from models.transaction import TransactionModel
        generated = TransactionModel.query.filter_by(recurring_id=rec.id).all()
        assert len(generated) == 2

    def test_does_not_generate_future_transactions(self, account):
        future = date.today() + timedelta(days=10)
        rec = self._make_recurring(account, future)
        count = recurring_svc.process_due_recurring(account.id)
        assert count == 0

    def test_generated_transaction_linked_to_recurring(self, account):
        past = date.today() - timedelta(days=1)
        rec = self._make_recurring(account, past)
        recurring_svc.process_due_recurring(account.id)
        from models.transaction import TransactionModel
        tx = TransactionModel.query.filter_by(recurring_id=rec.id).first()
        assert tx is not None
        assert tx.vendor == 'Quizlet'
        assert tx.amount == pytest.approx(-20.67)


# ── Recurring schedules ───────────────────────────────────────────────────────

def _schedule(account, start, frequency=1, unit='months', number=-1):
    return recurring_svc.add_recurring(account.id, start, 'ASPIRE', 'Loan', -75.0, start, frequency,
                             number=number, frequency_unit=unit)


def _generated_dates(rec):
    from models.transaction import TransactionModel
    return [t.date for t in TransactionModel.query.filter_by(recurring_id=rec.id).order_by(TransactionModel.date)]


class TestRecurringSchedules:
    def test_monthly_repeats_on_the_same_day(self, account):
        rec = _schedule(account, date(2025, 1, 15), number=3)
        recurring_svc.process_due_recurring(account.id)
        assert _generated_dates(rec) == [date(2025, 1, 15), date(2025, 2, 15), date(2025, 3, 15)]

    def test_short_months_use_their_last_day_without_drifting(self, account):
        rec = _schedule(account, date(2025, 1, 31), number=4)
        recurring_svc.process_due_recurring(account.id)
        assert _generated_dates(rec) == [date(2025, 1, 31), date(2025, 2, 28), date(2025, 3, 31), date(2025, 4, 30)]

    def test_yearly_from_a_leap_day(self, account):
        rec = _schedule(account, date(2024, 2, 29), frequency=12, number=2)
        recurring_svc.process_due_recurring(account.id)
        assert _generated_dates(rec) == [date(2024, 2, 29), date(2025, 2, 28)]

    def test_quarterly_crosses_years(self, account):
        rec = _schedule(account, date(2024, 11, 30), frequency=3, number=3)
        recurring_svc.process_due_recurring(account.id)
        assert _generated_dates(rec) == [date(2024, 11, 30), date(2025, 2, 28), date(2025, 5, 30)]

    def test_day_based_schedules_still_count_days(self, account):
        rec = _schedule(account, date(2026, 7, 20), frequency=14, unit='days', number=3)
        recurring_svc.process_due_recurring(account.id)
        assert _generated_dates(rec) == [date(2026, 7, 20), date(2026, 8, 3), date(2026, 8, 17)]

    def test_moving_the_next_date_re_anchors_a_monthly_template(self, account):
        rec = _schedule(account, date(2099, 1, 31))
        recurring_svc.update_recurring(rec.id, next_date=date(2099, 3, 15))
        assert (rec.day_of_month, rec.advance_to_next) == (15, date(2099, 4, 15))

    def test_re_saving_an_unchanged_next_date_keeps_the_anchor(self, account):
        rec = _schedule(account, date(2025, 1, 31), number=1)
        recurring_svc.process_due_recurring(account.id)   # next date is now Feb 28, clamped from the 31st
        recurring_svc.update_recurring(rec.id, next_date=date(2025, 2, 28), amount=-80.0)
        assert (rec.day_of_month, rec.advance_to_next) == (31, date(2025, 3, 31))

    def test_switching_to_months_anchors_on_the_next_date(self, account):
        rec = _schedule(account, date(2099, 1, 31), frequency=30, unit='days')
        recurring_svc.update_recurring(rec.id, frequency=1, frequency_unit='months')
        assert (rec.day_of_month, rec.advance_to_next) == (31, date(2099, 2, 28))

    def test_switching_to_days_drops_the_anchor(self, account):
        rec = _schedule(account, date(2099, 1, 31))
        recurring_svc.update_recurring(rec.id, frequency=14, frequency_unit='days')
        assert (rec.day_of_month, rec.advance_to_next) == (None, date(2099, 2, 14))

    @pytest.mark.parametrize('frequency, unit, error', [
        (0, 'days', 'Frequency must be a whole number of at least 1.'),
        (-1, 'months', 'Frequency must be a whole number of at least 1.'),
        (1.5, 'days', 'Frequency must be a whole number of at least 1.'),
        (True, 'days', 'Frequency must be a whole number of at least 1.'),
        (1, 'weeks', "Frequency unit must be 'days' or 'months'."),
    ], ids=['zero', 'negative', 'fraction', 'bool', 'unknown-unit'])
    def test_rejects_invalid_schedules(self, account, frequency, unit, error):
        with pytest.raises(ValueError, match=f'^{re.escape(error)}$'):
            _schedule(account, date(2099, 1, 1), frequency=frequency, unit=unit)
        rec = _schedule(account, date(2099, 1, 1))
        with pytest.raises(ValueError, match=f'^{re.escape(error)}$'):
            recurring_svc.update_recurring(rec.id, frequency=frequency, frequency_unit=unit)

    def test_to_dict_reports_the_unit_and_the_last_occurrence(self, account):
        rec = _schedule(account, date(2025, 1, 31), number=2)
        assert rec.to_dict()['last_date'] is None
        recurring_svc.process_due_recurring(account.id)
        d = rec.to_dict()
        assert (d['frequency_unit'], d['last_date'], d['next_date']) == ('months', '2025-02-28', '2025-03-31')


class TestSeriesRenames:
    """Changing a template's vendor and/or category carries over to every transaction in its series."""

    def _series(self, account, pin_today):
        """Monthly Anthropic series that generated Aug 2 and Sep 2, plus a linked imported Jul 3 row."""
        pin_today(date(2026, 9, 10))
        imported = svc.add_transaction(account.id, date(2026, 7, 3), 'ANTHROPIC ', 'Subscription', -20.0, notes='Claude')
        rec = recurring_svc.add_recurring(account.id, date(2026, 8, 2), 'Anthropic', 'Subscriptions', -20.0,
                                          date(2026, 8, 2), 1, frequency_unit='months')
        recurring_svc.process_due_recurring(account.id)
        recurring_svc.link_transaction(rec.id, imported.id)
        return rec

    def _rows(self, rec):
        from models.transaction import TransactionModel
        rows = TransactionModel.query.filter_by(recurring_id=rec.id).order_by(TransactionModel.date)
        return [(t.date, t.vendor, t.category, t.amount, t.notes) for t in rows]

    def test_a_new_vendor_renames_every_transaction_in_the_series(self, account, pin_today):
        rec = self._series(account, pin_today)
        bystander = svc.add_transaction(account.id, date(2026, 9, 5), 'Anthropic', 'Subscriptions', -20.0)
        recurring_svc.update_recurring(rec.id, vendor='Claude Pro')
        assert self._rows(rec) == [
            (date(2026, 7, 3), 'Claude Pro', 'Subscription', -20.0, 'Claude'),
            (date(2026, 8, 2), 'Claude Pro', 'Subscriptions', -20.0, ''),
            (date(2026, 9, 2), 'Claude Pro', 'Subscriptions', -20.0, ''),
        ]
        assert bystander.vendor == 'Anthropic'   # not in the series

    def test_a_new_category_recategorizes_every_transaction_in_the_series(self, account, pin_today):
        rec = self._series(account, pin_today)
        recurring_svc.update_recurring(rec.id, category='AI Tools')
        assert [category for _, _, category, _, _ in self._rows(rec)] == ['AI Tools'] * 3

    def test_both_at_once(self, account, pin_today):
        rec = self._series(account, pin_today)
        recurring_svc.update_recurring(rec.id, vendor='Claude Pro', category='AI Tools')
        assert {(vendor, category) for _, vendor, category, _, _ in self._rows(rec)} == {('Claude Pro', 'AI Tools')}

    def test_saving_unchanged_names_leaves_the_series_alone(self, account, pin_today):
        rec = self._series(account, pin_today)
        recurring_svc.update_recurring(rec.id, vendor='Anthropic', category='Subscriptions', amount=-22.0)
        assert self._rows(rec)[0][1:3] == ('ANTHROPIC ', 'Subscription')   # the imported row keeps its own spelling

    def _over(self, account, transaction):
        return transaction.id in BudgetFlagService().over_budget_ids(account.user_id, [transaction])

    def test_budget_flags_follow_the_spending_out_of_the_old_category(self, account, pin_today):
        rec = self._series(account, pin_today)
        spotify = svc.add_transaction(account.id, date(2026, 9, 5), 'Spotify', 'Subscriptions', -10.0)
        BudgetService().create_budget(account.user_id, 'Subscriptions', '2026-09', 25.0)
        assert self._over(account, spotify)        # Anthropic's $20 (Sep 2) + Spotify's $10 passes $25
        recurring_svc.update_recurring(rec.id, category='AI Tools')
        assert not self._over(account, spotify)    # Anthropic no longer counts toward Subscriptions

    def test_budget_flags_follow_the_spending_into_the_new_category(self, account, pin_today):
        rec = self._series(account, pin_today)
        BudgetService().create_budget(account.user_id, 'Subscriptions', '2026-09', 15.0)
        from models.transaction import TransactionModel
        september = TransactionModel.query.filter_by(recurring_id=rec.id, date=date(2026, 9, 2)).one()
        assert self._over(account, september)
        recurring_svc.update_recurring(rec.id, category='AI Tools')   # no AI Tools budget
        assert not self._over(account, september)
        BudgetService().create_budget(account.user_id, 'AI Tools', '2026-09', 10.0)
        assert self._over(account, september)

    def test_a_transfer_peer_follows(self, account, pin_today):
        rec = self._series(account, pin_today)
        savings = AccountModel(user_id=account.user_id, acct_id_str='sav-1', acct_name='Savings')
        _db.session.add(savings)
        _db.session.commit()
        from models.transaction import TransactionModel
        september = TransactionModel.query.filter_by(recurring_id=rec.id, date=date(2026, 9, 2)).one()
        _, peer, _ = svc.create_transfer_pair(september.id, savings.id)
        recurring_svc.update_recurring(rec.id, vendor='Claude Pro', category='AI Tools')
        assert (peer.vendor, peer.category) == ('Claude Pro', 'AI Tools')


class TestSkipPastOccurrences:
    def _add(self, account, start, frequency=1, unit='months', skip_past=True, number=-1):
        rec = recurring_svc.add_recurring(account.id, start, 'ASPIRE', 'Loan', -75.0, start, frequency,
                                number=number, frequency_unit=unit, skip_past=skip_past)
        recurring_svc.process_due_recurring(account.id)
        return rec

    def test_starts_at_the_next_occurrence_without_generating_history(self, account, pin_today):
        pin_today(date(2026, 10, 24))
        rec = self._add(account, date(2025, 1, 31))
        assert (rec.start_date, rec.next_date, rec.day_of_month, rec.idx) == (date(2026, 10, 31), date(2026, 10, 31), 31, 1)
        assert _generated_dates(rec) == []

    def test_keeps_the_monthly_day_when_the_next_occurrence_is_clamped(self, account, pin_today):
        pin_today(date(2026, 11, 5))
        rec = self._add(account, date(2025, 1, 31))
        assert (rec.next_date, rec.advance_to_next) == (date(2026, 11, 30), date(2026, 12, 31))

    def test_day_based_schedules_keep_their_rhythm(self, account, pin_today):
        pin_today(date(2026, 10, 24))
        rec = self._add(account, date(2026, 7, 20), frequency=14, unit='days')
        assert rec.next_date == date(2026, 10, 26)

    def test_an_occurrence_due_today_is_generated(self, account, pin_today):
        pin_today(date(2026, 10, 24))
        rec = self._add(account, date(2026, 10, 10), frequency=14, unit='days')
        assert (_generated_dates(rec), rec.next_date) == ([date(2026, 10, 24)], date(2026, 11, 7))

    def test_a_future_start_is_unchanged(self, account, pin_today):
        pin_today(date(2026, 10, 24))
        rec = self._add(account, date(2026, 11, 3))
        assert (rec.start_date, rec.next_date) == (date(2026, 11, 3), date(2026, 11, 3))

    def test_without_it_past_occurrences_are_generated(self, account, pin_today):
        pin_today(date(2026, 10, 24))
        rec = self._add(account, date(2026, 8, 3), skip_past=False)
        assert (_generated_dates(rec), rec.next_date) == ([date(2026, 8, 3), date(2026, 9, 3), date(2026, 10, 3)], date(2026, 11, 3))


class TestGenerationAdoptsMatches:
    """A due occurrence links an existing exact match instead of generating a second copy."""

    def _monthly(self, account, start=date(2026, 9, 2)):
        return recurring_svc.add_recurring(account.id, start, 'Anthropic', 'Subscriptions', -20.0,
                                           start, 1, frequency_unit='months')

    def _charge(self, account, day, amount=-20.0):
        return svc.add_transaction(account.id, day, 'Anthropic', 'Subscription', amount)

    def _series(self, rec):
        from models.transaction import TransactionModel
        rows = TransactionModel.query.filter_by(recurring_id=rec.id).order_by(TransactionModel.recurring_index)
        return [(t.recurring_index, t.date, t.id) for t in rows]

    def test_an_exact_match_within_three_days_is_linked_instead_of_generated(self, account, pin_today):
        pin_today(date(2026, 9, 10))
        imported = self._charge(account, date(2026, 9, 3))   # posted a day late; another category is fine
        rec = self._monthly(account)
        balance = db_svc.get_account(account.id).balance
        assert recurring_svc.process_due_recurring(account.id) == 0
        assert self._series(rec) == [(1, date(2026, 9, 3), imported.id)]
        assert (rec.next_date, rec.idx) == (date(2026, 10, 2), 2)
        assert db_svc.get_account(account.id).balance == balance

    @pytest.mark.parametrize('day, amount', [(date(2026, 9, 6), -20.0), (date(2026, 9, 2), -25.0)],
                             ids=['4-days-away', 'another-amount'])
    def test_anything_short_of_an_exact_match_is_left_alone(self, account, pin_today, day, amount):
        pin_today(date(2026, 9, 10))
        other = self._charge(account, day, amount)
        rec = self._monthly(account)
        assert recurring_svc.process_due_recurring(account.id) == 1
        assert [d for _, d, tx_id in self._series(rec)] == [date(2026, 9, 2)]
        assert other.recurring_id is None

    def test_a_dismissed_transaction_is_not_adopted(self, account, pin_today):
        pin_today(date(2026, 8, 25))
        imported = self._charge(account, date(2026, 9, 2))
        rec = self._monthly(account)
        recurring_svc.dismiss_suggestion(rec.id, imported.id)
        pin_today(date(2026, 9, 10))
        assert recurring_svc.process_due_recurring(account.id) == 1
        assert imported.recurring_id is None

    def test_the_nearest_of_several_matches_is_adopted(self, account, pin_today):
        pin_today(date(2026, 9, 10))
        early, exact = self._charge(account, date(2026, 8, 31)), self._charge(account, date(2026, 9, 2))
        rec = self._monthly(account)
        recurring_svc.process_due_recurring(account.id)
        assert self._series(rec) == [(1, date(2026, 9, 2), exact.id)]
        assert early.recurring_id is None   # left for the suggestions to show as a possible duplicate

    def test_adding_past_occurrences_adopts_imported_history(self, account, pin_today):
        pin_today(date(2026, 10, 25))
        imported = [self._charge(account, d) for d in (date(2026, 7, 2), date(2026, 8, 3), date(2026, 9, 3))]
        rec = self._monthly(account, start=date(2026, 7, 2))
        assert recurring_svc.process_due_recurring(account.id) == 1   # only Oct 2 had no copy
        assert [(i, d) for i, d, _ in self._series(rec)] == [
            (1, date(2026, 7, 2)), (2, date(2026, 8, 3)), (3, date(2026, 9, 3)), (4, date(2026, 10, 2)),
        ]
        assert [tx_id for _, _, tx_id in self._series(rec)][:3] == [t.id for t in imported]


class TestSeriesMembership:
    """Matching existing transactions to a series, linking them in, and taking them out."""

    def _series(self, account, pin_today, number=-1):
        """A monthly -$20 Anthropic series that has generated Mar 2, Apr 2 and May 2 (next: Jun 2)."""
        pin_today(date(2026, 5, 10))
        rec = recurring_svc.add_recurring(account.id, date(2026, 3, 2), 'Anthropic', 'Subscriptions', -20.0,
                                          date(2026, 3, 2), 1, number=number, frequency_unit='months')
        recurring_svc.process_due_recurring(account.id)
        return rec

    def _charge(self, account, day, vendor='Anthropic', amount=-20.0):
        return svc.add_transaction(account.id, day, vendor, 'Subscriptions', amount)

    def _occurrences(self, rec):
        from models.transaction import TransactionModel
        rows = TransactionModel.query.filter_by(recurring_id=rec.id).order_by(TransactionModel.recurring_index)
        return [(t.recurring_index, t.date) for t in rows]

    def _other_account(self, account):
        other = AccountModel(user_id=account.user_id, acct_id_str='card-1', acct_name='Card')
        _db.session.add(other)
        _db.session.commit()
        return other

    def test_candidates_share_account_vendor_and_amount_within_three_days_nearest_first(self, account, pin_today):
        rec = self._series(account, pin_today)
        one_day = self._charge(account, date(2026, 6, 3), vendor=' anthropic ')
        two_days = self._charge(account, date(2026, 5, 31))
        self._charge(account, date(2026, 6, 6))                      # 4 days away
        self._charge(account, date(2026, 6, 2), amount=-25.0)        # another amount
        self._charge(account, date(2026, 6, 2), vendor='Netflix')    # another vendor
        svc.add_transaction(self._other_account(account).id, date(2026, 6, 2), 'Anthropic', 'Subscriptions', -20.0)
        assert recurring_svc.match_candidates(rec, date(2026, 6, 2)) == [one_day, two_days]

    def test_candidates_leave_out_transactions_already_in_a_series(self, account, pin_today):
        rec = self._series(account, pin_today)
        assert recurring_svc.match_candidates(rec, date(2026, 5, 2)) == []

    def test_linking_an_older_transaction_extends_the_history(self, account, pin_today):
        rec = self._series(account, pin_today)
        recurring_svc.link_transaction(rec.id, self._charge(account, date(2026, 2, 3)).id)
        assert self._occurrences(rec) == [(1, date(2026, 2, 3)), (2, date(2026, 3, 2)), (3, date(2026, 4, 2)), (4, date(2026, 5, 2))]
        assert (rec.start_date, rec.next_date, rec.idx, rec.number) == (date(2026, 2, 3), date(2026, 6, 2), 5, -1)

    def test_a_limited_series_keeps_its_remaining_occurrences(self, account, pin_today):
        rec = self._series(account, pin_today, number=5)    # 3 generated, 2 to go
        recurring_svc.link_transaction(rec.id, self._charge(account, date(2026, 2, 3)).id)
        assert (rec.idx, rec.number) == (5, 6)              # still 2 to go

    @pytest.mark.parametrize('day', [date(2026, 5, 30), date(2026, 6, 5)], ids=['3-days-early', '3-days-late'])
    def test_a_transaction_near_the_next_occurrence_fills_it(self, account, pin_today, day):
        rec = self._series(account, pin_today, number=5)
        recurring_svc.link_transaction(rec.id, self._charge(account, day).id)
        assert (rec.next_date, rec.idx, rec.number) == (date(2026, 7, 2), 5, 5)   # 1 to go
        assert self._occurrences(rec)[-1] == (4, day)

    def test_linking_leaves_the_transaction_and_balance_alone(self, account, pin_today):
        rec = self._series(account, pin_today)
        older = self._charge(account, date(2026, 2, 3), amount=-19.0)   # a manual link needn't match
        balance = db_svc.get_account(account.id).balance
        recurring_svc.link_transaction(rec.id, older.id)
        assert (older.amount, older.vendor) == (-19.0, 'Anthropic')
        assert db_svc.get_account(account.id).balance == balance

    def test_rejects_a_transaction_on_another_account(self, account, pin_today):
        rec = self._series(account, pin_today)
        elsewhere = svc.add_transaction(self._other_account(account).id, date(2026, 2, 3), 'Anthropic', 'Subscriptions', -20.0)
        with pytest.raises(ValueError, match='^A transaction can only join a recurring series on its own account.$'):
            recurring_svc.link_transaction(rec.id, elsewhere.id)

    def test_rejects_a_transaction_already_in_a_series(self, account, pin_today):
        rec = self._series(account, pin_today)
        from models.transaction import TransactionModel
        generated = TransactionModel.query.filter_by(recurring_id=rec.id).first()
        with pytest.raises(ValueError, match='^That transaction is already part of a recurring series.$'):
            recurring_svc.link_transaction(rec.id, generated.id)

    def test_rejects_a_transaction_after_the_next_occurrence(self, account, pin_today):
        rec = self._series(account, pin_today)
        with pytest.raises(ValueError, match=r"^That transaction is dated after the series' next occurrence \(Jun 2, 2026\)\.$"):
            recurring_svc.link_transaction(rec.id, self._charge(account, date(2026, 6, 6)).id)

    def test_missing_records_are_reported(self, account, pin_today):
        rec = self._series(account, pin_today)
        with pytest.raises(ValueError, match='^Transaction not found.$'):
            recurring_svc.link_transaction(rec.id, 999999)
        with pytest.raises(ValueError, match='^Recurring transaction not found.$'):
            recurring_svc.link_transaction(999999, self._charge(account, date(2026, 2, 3)).id)

    def test_unlinking_keeps_the_transaction_and_shrinks_the_series(self, account, pin_today):
        rec = self._series(account, pin_today, number=5)
        from models.transaction import TransactionModel
        april = TransactionModel.query.filter_by(recurring_id=rec.id, recurring_index=2).one()
        recurring_svc.unlink_transaction(rec.id, april.id)
        assert (april.recurring_id, april.recurring_index) == (None, None)
        assert self._occurrences(rec) == [(1, date(2026, 3, 2)), (2, date(2026, 5, 2))]
        assert (rec.idx, rec.number, rec.next_date) == (3, 4, date(2026, 6, 2))

    def test_unlinking_a_transaction_outside_the_series_is_rejected(self, account, pin_today):
        rec = self._series(account, pin_today)
        loose = self._charge(account, date(2026, 2, 3))
        with pytest.raises(ValueError, match="^That transaction isn't part of this recurring series.$"):
            recurring_svc.unlink_transaction(rec.id, loose.id)


class TestSeriesSuggestions:
    """Transactions that may belong to a series, found by walking its schedule back (nothing is linked)."""

    def _charge(self, account, day, vendor='ASPIRE', amount=-75.0, category='Loan'):
        return svc.add_transaction(account.id, day, vendor, category, amount)

    def _summary(self, suggestions):
        return [(s['date'], s['kind'], [t.date for t in s['candidates']]) for s in suggestions]

    def test_history_before_the_start_is_suggested_oldest_first(self, account, pin_today):
        pin_today(date(2026, 10, 25))
        for day in [date(2026, 4, 30), date(2026, 6, 1), date(2026, 6, 3), date(2026, 6, 30),
                    date(2026, 7, 31), date(2026, 8, 31), date(2026, 9, 30)]:
            self._charge(account, day)
        self._charge(account, date(2026, 3, 31), amount=-45.0)   # suggestions accept other amounts
        rec = recurring_svc.add_recurring(account.id, date(2026, 10, 31), 'ASPIRE', 'Loan', -75.0,
                                          date(2026, 10, 31), 1, frequency_unit='months')
        assert self._summary(recurring_svc.suggest_matches(rec.id)) == [
            (date(2026, 3, 31), 'history', [date(2026, 3, 31)]),
            (date(2026, 4, 30), 'history', [date(2026, 4, 30)]),
            (date(2026, 5, 31), 'history', [date(2026, 6, 1), date(2026, 6, 3)]),
            (date(2026, 6, 30), 'history', [date(2026, 6, 30)]),
            (date(2026, 7, 31), 'history', [date(2026, 7, 31)]),
            (date(2026, 8, 31), 'history', [date(2026, 8, 31)]),
            (date(2026, 9, 30), 'history', [date(2026, 9, 30)]),
        ]

    def test_the_history_walk_stops_after_two_occurrences_without_a_match(self, account, pin_today):
        pin_today(date(2026, 10, 25))
        for day in [date(2026, 9, 28), date(2026, 9, 14), date(2026, 8, 3)]:   # nothing Aug 31 or Aug 17
            self._charge(account, day, vendor='Allina Health', amount=-87.38, category='Medical')
        rec = recurring_svc.add_recurring(account.id, date(2026, 10, 26), 'Allina Health', 'Medical', -87.38,
                                          date(2026, 10, 26), 14)
        # Oct 12 has no match either, but the Sep 28 match after it keeps the walk going
        assert self._summary(recurring_svc.suggest_matches(rec.id)) == [
            (date(2026, 9, 14), 'history', [date(2026, 9, 14)]),
            (date(2026, 9, 28), 'history', [date(2026, 9, 28)]),
        ]

    def test_a_second_copy_of_a_covered_occurrence_is_a_possible_duplicate(self, account, pin_today):
        pin_today(date(2026, 5, 10))
        rec = recurring_svc.add_recurring(account.id, date(2026, 3, 2), 'Anthropic', 'Subscriptions', -20.0,
                                          date(2026, 3, 2), 1, frequency_unit='months')
        recurring_svc.process_due_recurring(account.id)   # generates Mar 2, Apr 2, May 2
        self._charge(account, date(2026, 4, 2), vendor='Anthropic', amount=-20.0, category='Subscriptions')
        self._charge(account, date(2026, 5, 3), vendor='Anthropic', amount=-20.0, category='Subscriptions')
        suggestions = recurring_svc.suggest_matches(rec.id)
        assert self._summary(suggestions) == [
            (date(2026, 4, 2), 'duplicate', [date(2026, 4, 2)]),
            (date(2026, 5, 2), 'duplicate', [date(2026, 5, 3)]),
        ]
        assert [[t.recurring_id for t in s['linked']] for s in suggestions] == [[rec.id], [rec.id]]

    def test_an_occurrence_the_series_lost_can_be_filled(self, account, pin_today):
        pin_today(date(2026, 5, 10))
        rec = recurring_svc.add_recurring(account.id, date(2026, 3, 2), 'Anthropic', 'Subscriptions', -20.0,
                                          date(2026, 3, 2), 1, frequency_unit='months')
        recurring_svc.process_due_recurring(account.id)
        from models.transaction import TransactionModel
        svc.delete_transaction(TransactionModel.query.filter_by(recurring_id=rec.id, date=date(2026, 4, 2)).one().id)
        assert recurring_svc.suggest_matches(rec.id) == []   # a gap with nothing to fill it isn't suggested
        self._charge(account, date(2026, 4, 3), vendor='Anthropic', amount=-20.0, category='Subscriptions')
        assert self._summary(recurring_svc.suggest_matches(rec.id)) == [(date(2026, 4, 2), 'missing', [date(2026, 4, 3)])]

    def _rent(self, account, pin_today, start=date(2026, 7, 1)):
        """Monthly $650 rent due on the 1st, from `start` (no history linked)."""
        pin_today(start - timedelta(days=10))
        return recurring_svc.add_recurring(account.id, start, 'Millenium Apartments', 'Rent', -650.0,
                                           start, 1, frequency_unit='months')

    def test_an_early_payment_or_another_amount_still_suggests(self, account, pin_today):
        rec = self._rent(account, pin_today)
        self._charge(account, date(2026, 5, 26), vendor='Millenium Apartments', amount=-650.0, category='Rent')   # 6 days early for Jun 1
        self._charge(account, date(2026, 5, 1), vendor='Millenium Apartments', amount=-652.49, category='Rent')  # with a fee
        assert self._summary(recurring_svc.suggest_matches(rec.id)) == [
            (date(2026, 5, 1), 'history', [date(2026, 5, 1)]),
            (date(2026, 6, 1), 'history', [date(2026, 5, 26)]),
        ]

    def test_up_to_three_days_late_belongs_to_the_occurrence_before(self, account, pin_today):
        rec = self._rent(account, pin_today, start=date(2026, 8, 1))
        self._charge(account, date(2026, 6, 4), vendor='Millenium Apartments', amount=-650.0, category='Rent')   # 3 days after Jun 1
        self._charge(account, date(2026, 6, 5), vendor='Millenium Apartments', amount=-650.0, category='Rent')   # 26 days before Jul 1
        assert self._summary(recurring_svc.suggest_matches(rec.id)) == [
            (date(2026, 6, 1), 'history', [date(2026, 6, 4)]),
            (date(2026, 7, 1), 'history', [date(2026, 6, 5)]),
        ]

    def test_another_category_needs_the_exact_amount(self, account, pin_today):
        rec = self._rent(account, pin_today, start=date(2026, 8, 1))
        svc.add_transaction(account.id, date(2026, 7, 1), 'Millenium Apartments', 'Rent payment', -650.0)
        svc.add_transaction(account.id, date(2026, 6, 1), 'Millenium Apartments', 'Deposit', -1300.0)
        assert self._summary(recurring_svc.suggest_matches(rec.id)) == [
            (date(2026, 7, 1), 'history', [date(2026, 7, 1)]),
        ]

    def test_money_going_the_other_way_is_never_suggested(self, account, pin_today):
        rec = self._rent(account, pin_today)
        self._charge(account, date(2026, 6, 1), vendor='Millenium Apartments', amount=216.0, category='Rent')   # refund
        assert recurring_svc.suggest_matches(rec.id) == []

    def _aspire(self, account, pin_today):
        """A monthly ASPIRE template from Oct 31 with unlinked $75 payments on Aug 31 and Sep 30."""
        pin_today(date(2026, 10, 25))
        payments = [self._charge(account, date(2026, 8, 31)), self._charge(account, date(2026, 9, 30))]
        rec = recurring_svc.add_recurring(account.id, date(2026, 10, 31), 'ASPIRE', 'Loan', -75.0,
                                          date(2026, 10, 31), 1, frequency_unit='months')
        return rec, payments

    def test_a_dismissed_transaction_is_no_longer_suggested(self, account, pin_today):
        rec, (august, september) = self._aspire(account, pin_today)
        recurring_svc.dismiss_suggestion(rec.id, september.id)
        recurring_svc.dismiss_suggestion(rec.id, september.id)   # dismissing twice is harmless
        assert self._summary(recurring_svc.suggest_matches(rec.id)) == [(date(2026, 8, 31), 'history', [date(2026, 8, 31)])]

    def test_a_dismissal_can_be_undone(self, account, pin_today):
        rec, (_, september) = self._aspire(account, pin_today)
        recurring_svc.dismiss_suggestion(rec.id, september.id)
        recurring_svc.undo_dismissal(rec.id, september.id)
        assert len(recurring_svc.suggest_matches(rec.id)) == 2

    def test_only_transactions_outside_the_series_on_its_account_can_be_dismissed(self, account, pin_today):
        rec, (august, _) = self._aspire(account, pin_today)
        recurring_svc.link_transaction(rec.id, august.id)
        with pytest.raises(ValueError, match='^That transaction is part of this recurring series.$'):
            recurring_svc.dismiss_suggestion(rec.id, august.id)
        other = AccountModel(user_id=account.user_id, acct_id_str='card-1', acct_name='Card')
        _db.session.add(other)
        _db.session.commit()
        elsewhere = svc.add_transaction(other.id, date(2026, 9, 30), 'ASPIRE', 'Loan', -75.0)
        with pytest.raises(ValueError, match="^That transaction isn't on this recurring series' account.$"):
            recurring_svc.dismiss_suggestion(rec.id, elsewhere.id)

    def test_the_template_needs_attention_while_suggestions_are_left(self, account, pin_today):
        rec, (august, september) = self._aspire(account, pin_today)
        assert {k: recurring_svc.template_dict(rec)[k] for k in ('suggestion_count', 'needs_attention')} == \
            {'suggestion_count': 2, 'needs_attention': True}
        recurring_svc.link_transaction(rec.id, august.id)
        recurring_svc.dismiss_suggestion(rec.id, september.id)
        assert {k: recurring_svc.template_dict(rec)[k] for k in ('suggestion_count', 'needs_attention')} == \
            {'suggestion_count': 0, 'needs_attention': False}

    def test_the_template_lists_the_transactions_marked_unrelated(self, account, pin_today):
        rec, (august, september) = self._aspire(account, pin_today)
        assert recurring_svc.template_dict(rec)['dismissed_transaction_ids'] == []
        recurring_svc.dismiss_suggestion(rec.id, september.id)
        recurring_svc.dismiss_suggestion(rec.id, august.id)
        assert recurring_svc.template_dict(rec)['dismissed_transaction_ids'] == sorted([august.id, september.id])

    def test_linking_a_transaction_marked_unrelated_clears_the_mark(self, account, pin_today):
        from models.recurring_dismissal import RecurringDismissalModel
        rec, (_, september) = self._aspire(account, pin_today)
        recurring_svc.dismiss_suggestion(rec.id, september.id)
        recurring_svc.link_transaction(rec.id, september.id)
        assert september.recurring_id == rec.id
        assert RecurringDismissalModel.query.count() == 0
        assert recurring_svc.template_dict(rec)['dismissed_transaction_ids'] == []

    def test_dismissals_go_when_the_template_or_the_transaction_does(self, account, pin_today):
        from models.recurring_dismissal import RecurringDismissalModel
        rec, (august, september) = self._aspire(account, pin_today)
        recurring_svc.dismiss_suggestion(rec.id, august.id)
        recurring_svc.dismiss_suggestion(rec.id, september.id)
        svc.delete_transaction(august.id)
        assert RecurringDismissalModel.query.count() == 1
        recurring_svc.delete_recurring(rec.id)
        assert RecurringDismissalModel.query.count() == 0

    def test_suggesting_links_nothing(self, account, pin_today):
        pin_today(date(2026, 10, 25))
        old = self._charge(account, date(2026, 9, 30))
        rec = recurring_svc.add_recurring(account.id, date(2026, 10, 31), 'ASPIRE', 'Loan', -75.0,
                                          date(2026, 10, 31), 1, frequency_unit='months')
        recurring_svc.suggest_matches(rec.id)
        assert (old.recurring_id, rec.idx) == (None, 1)


# ── Delete recurring ──────────────────────────────────────────────────────────

class TestDeleteRecurring:
    def test_delete_keeps_generated_by_default(self, account):
        past = date.today() - timedelta(days=1)
        rec = recurring_svc.add_recurring(account.id, past, 'Spotify', 'Subscriptions', -9.99, past, 30)
        recurring_svc.process_due_recurring(account.id)
        rec_id = rec.id
        recurring_svc.delete_recurring(rec_id, delete_generated=False)
        from models.transaction import TransactionModel
        orphaned = TransactionModel.query.filter_by(recurring_id=None, vendor='Spotify').all()
        assert len(orphaned) >= 1

    def test_delete_removes_generated_when_flagged(self, account):
        past = date.today() - timedelta(days=1)
        rec = recurring_svc.add_recurring(account.id, past, 'Spotify', 'Subscriptions', -9.99, past, 30)
        recurring_svc.process_due_recurring(account.id)
        rec_id = rec.id
        recurring_svc.delete_recurring(rec_id, delete_generated=True)
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
