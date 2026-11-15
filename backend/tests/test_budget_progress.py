"""
Budget progress and the scheduled-pace setting: GET /api/budgets/progress (each budget's spending,
which budget pace draws) and PUT /api/budgets/scheduled-pace (Phase V, V1).
"""
from datetime import date

import pytest

from extensions import db as _db
from models.account import AccountModel
from models.scheduled_pace import ScheduledPaceModel
from models.user import User
from services.account_service import AccountService
from services.budget_service import BudgetService

account_svc = AccountService()
budget_svc = BudgetService()


def spend(account, day, category, amount, **fields):
    account_svc.add_transaction(account.id, day, 'Shop', category, amount, **fields)


def progress(client, headers, period='2026-10'):
    resp = client.get(f'/api/budgets/progress?period={period}', headers=headers)
    assert resp.status_code == 200, resp.json
    return {row['category']: row for row in resp.json['progress']}


def set_pace(client, headers, category, scheduled):
    return client.put('/api/budgets/scheduled-pace', headers=headers,
                      json={'category': category, 'scheduled': scheduled})


@pytest.fixture
def other(client):
    """A second user with an account, logged in: (account, headers)."""
    u = User(username='otheruser', email='other@example.com')
    u.set_password('otherpass')
    _db.session.add(u)
    _db.session.commit()
    acct = AccountModel(user_id=u.id, acct_id_str='other-1', acct_name='Other Checking')
    _db.session.add(acct)
    _db.session.commit()
    token = client.post('/api/auth/login', json={'username': 'otheruser', 'password': 'otherpass'}).json['access_token']
    return acct, {'Authorization': f'Bearer {token}'}


class TestProgress:
    def test_requires_login(self, client):
        assert client.get('/api/budgets/progress?period=2026-10').status_code == 401

    def test_no_budgets_no_rows(self, client, auth_headers, account):
        spend(account, date(2026, 10, 3), 'Groceries', -50.0)
        assert progress(client, auth_headers) == {}

    def test_a_row_reports_the_spending_against_the_budget(self, client, auth_headers, user, account):
        budget = budget_svc.create_budget(user.id, 'Groceries', '2026-10', 400.0, rollover=True, carried_over=20.0)
        spend(account, date(2026, 10, 3), 'Groceries', -150.25)
        spend(account, date(2026, 10, 31), 'Groceries', -49.75)
        assert progress(client, auth_headers)['Groceries'] == {
            'id': budget.id, 'category': 'Groceries', 'period': '2026-10',
            'allocated': 400.0, 'allocated_cents': 40000, 'carried_over': 20.0, 'carried_over_cents': 2000,
            'spent': 200.0, 'spent_cents': 20000, 'remaining': 220.0, 'remaining_cents': 22000,
            'rollover': True, 'over_budget': False, 'scheduled_pace': False,
        }

    def test_spending_is_the_months_expenses_in_the_category_on_every_account(self, client, auth_headers, user, account):
        savings = AccountModel(user_id=user.id, acct_id_str='savings-1', acct_name='Savings')
        _db.session.add(savings)
        _db.session.commit()
        budget_svc.create_budget(user.id, 'Groceries', '2026-10', 400.0)
        spend(account, date(2026, 10, 1), 'Groceries', -10.0)
        spend(savings, date(2026, 10, 2), 'Groceries', -20.0)
        spend(account, date(2026, 9, 30), 'Groceries', -1000.0)    # other months
        spend(account, date(2026, 11, 1), 'Groceries', -1000.0)
        spend(account, date(2026, 10, 3), 'Fun', -1000.0)          # another category
        spend(account, date(2026, 10, 4), 'Groceries', 500.0)      # income, not a reimbursement
        assert progress(client, auth_headers)['Groceries']['spent_cents'] == 3000

    def test_transfers_never_count(self, client, auth_headers, user, account):
        budget_svc.create_budget(user.id, 'Groceries', '2026-10', 400.0)
        spend(account, date(2026, 10, 3), 'Groceries', -100.0, is_transfer=True)
        assert progress(client, auth_headers)['Groceries']['spent_cents'] == 0

    def test_reimbursements_lower_the_spending_but_never_below_zero(self, client, auth_headers, user, account):
        budget_svc.create_budget(user.id, 'Groceries', '2026-10', 400.0)
        budget_svc.create_budget(user.id, 'Medical', '2026-10', 100.0)
        spend(account, date(2026, 10, 3), 'Groceries', -100.0)
        spend(account, date(2026, 10, 9), 'Groceries', 30.0, is_reimbursement=True)
        spend(account, date(2026, 10, 3), 'Medical', -10.0)
        spend(account, date(2026, 10, 9), 'Medical', 25.0, is_reimbursement=True)
        rows = progress(client, auth_headers)
        assert rows['Groceries']['spent_cents'] == 7000
        assert rows['Medical']['spent_cents'] == 0

    def test_spending_past_the_budget_is_over_budget(self, client, auth_headers, user, account):
        budget_svc.create_budget(user.id, 'Fun', '2026-10', 50.0)
        spend(account, date(2026, 10, 3), 'Fun', -69.40)
        row = progress(client, auth_headers)['Fun']
        assert (row['remaining_cents'], row['over_budget']) == (-1940, True)

    def test_other_users_spending_and_budgets_are_left_out(self, client, auth_headers, user, account, other):
        other_account, _ = other
        budget_svc.create_budget(user.id, 'Groceries', '2026-10', 400.0)
        budget_svc.create_budget(other_account.user_id, 'Fun', '2026-10', 50.0)
        spend(other_account, date(2026, 10, 3), 'Groceries', -100.0)
        rows = progress(client, auth_headers)
        assert list(rows) == ['Groceries']
        assert rows['Groceries']['spent_cents'] == 0

    def test_rows_are_sorted_by_category(self, client, auth_headers, user, account):
        for category in ('Restaurants', 'Fun', 'Groceries'):
            budget_svc.create_budget(user.id, category, '2026-10', 100.0)
        assert list(progress(client, auth_headers)) == ['Fun', 'Groceries', 'Restaurants']


BAD_TEXT = "'category' must be text."
EMPTY = "'category' can't be empty."
TOO_LONG = "'category' must be at most 50 characters."
BAD_SCHEDULED = "'scheduled' must be true or false."


class TestScheduledPace:
    def test_requires_login(self, client):
        assert client.put('/api/budgets/scheduled-pace', json={'category': 'Fun', 'scheduled': True}).status_code == 401

    def test_setting_it_marks_the_category_in_every_month(self, client, auth_headers, user, account):
        for period in ('2026-10', '2026-11'):
            budget_svc.create_budget(user.id, 'Subscriptions', period, 60.0, rollover=True)
        budget_svc.create_budget(user.id, 'Groceries', '2026-10', 400.0)

        resp = set_pace(client, auth_headers, 'Subscriptions', True)
        assert (resp.status_code, resp.json) == (200, {'success': True, 'category': 'Subscriptions', 'scheduled': True})
        october = progress(client, auth_headers)
        assert (october['Subscriptions']['scheduled_pace'], october['Groceries']['scheduled_pace']) == (True, False)
        assert progress(client, auth_headers, '2026-11')['Subscriptions']['scheduled_pace'] is True

    def test_setting_it_again_changes_nothing(self, client, auth_headers, account):
        assert set_pace(client, auth_headers, 'Subscriptions', True).status_code == 200
        assert set_pace(client, auth_headers, 'Subscriptions', True).status_code == 200
        assert ScheduledPaceModel.query.count() == 1

    def test_turning_it_off_goes_back_to_an_even_pace(self, client, auth_headers, user, account):
        budget_svc.create_budget(user.id, 'Subscriptions', '2026-10', 60.0)
        set_pace(client, auth_headers, 'Subscriptions', True)
        resp = set_pace(client, auth_headers, 'Subscriptions', False)
        assert (resp.status_code, resp.json) == (200, {'success': True, 'category': 'Subscriptions', 'scheduled': False})
        assert progress(client, auth_headers)['Subscriptions']['scheduled_pace'] is False
        assert ScheduledPaceModel.query.count() == 0
        assert set_pace(client, auth_headers, 'Subscriptions', False).status_code == 200   # already off

    def test_the_setting_belongs_to_the_category_not_to_a_budget(self, client, auth_headers, user, account):
        set_pace(client, auth_headers, 'Subscriptions', True)      # before the category has a budget
        budget = budget_svc.create_budget(user.id, 'Subscriptions', '2026-10', 60.0)
        assert progress(client, auth_headers)['Subscriptions']['scheduled_pace'] is True
        client.delete(f'/api/budgets/{budget.id}', headers=auth_headers)
        budget_svc.create_budget(user.id, 'Subscriptions', '2026-10', 60.0)
        assert progress(client, auth_headers)['Subscriptions']['scheduled_pace'] is True

    def test_the_category_must_match_exactly(self, client, auth_headers, user, account):
        budget_svc.create_budget(user.id, 'Subscriptions', '2026-10', 60.0)
        set_pace(client, auth_headers, 'subscriptions', True)
        assert progress(client, auth_headers)['Subscriptions']['scheduled_pace'] is False

    def test_each_user_has_their_own(self, client, auth_headers, user, account, other):
        other_account, other_headers = other
        budget_svc.create_budget(user.id, 'Subscriptions', '2026-10', 60.0)
        budget_svc.create_budget(other_account.user_id, 'Subscriptions', '2026-10', 60.0)
        set_pace(client, other_headers, 'Subscriptions', True)
        assert progress(client, auth_headers)['Subscriptions']['scheduled_pace'] is False
        assert progress(client, other_headers)['Subscriptions']['scheduled_pace'] is True

    def test_fifty_characters_is_the_longest_category(self, client, auth_headers, account):
        assert set_pace(client, auth_headers, 'x' * 50, True).status_code == 200

    @pytest.mark.parametrize('body, error', [
        ({'scheduled': True}, BAD_TEXT),
        ({'category': 7, 'scheduled': True}, BAD_TEXT),
        ({'category': '', 'scheduled': True}, EMPTY),
        ({'category': '   ', 'scheduled': True}, EMPTY),
        ({'category': 'x' * 51, 'scheduled': True}, TOO_LONG),
        ({'category': 'Fun'}, BAD_SCHEDULED),
        ({'category': 'Fun', 'scheduled': 'true'}, BAD_SCHEDULED),
        ({'category': 'Fun', 'scheduled': 1}, BAD_SCHEDULED),
        ({'category': 'Fun', 'scheduled': None}, BAD_SCHEDULED),
    ])
    def test_invalid_input_returns_400(self, client, auth_headers, account, body, error):
        resp = client.put('/api/budgets/scheduled-pace', headers=auth_headers, json=body)
        assert (resp.status_code, resp.json) == (400, {'success': False, 'error': error})
        assert ScheduledPaceModel.query.count() == 0

    def test_a_body_that_isnt_json_returns_400(self, client, auth_headers, account):
        resp = client.put('/api/budgets/scheduled-pace', headers=auth_headers, data='Fun', content_type='text/plain')
        assert (resp.status_code, resp.json['error']) == (400, BAD_TEXT)

    def test_deleting_the_user_deletes_their_settings(self, user, account):
        budget_svc.set_scheduled_pace(user.id, 'Subscriptions', True)
        _db.session.delete(user)
        _db.session.commit()
        assert ScheduledPaceModel.query.count() == 0
