"""
Goals (Phase F, F2): a target balance on one of the user's accounts, savings up to an amount or a
loan down to $0 owed, with the user's own monthly amount if they set one. Goals run in order: a
goal is reached when the account's balance is at or past its target (and held from then on), and
the first goal in order that isn't reached is the active one, so a held goal that falls under its
target is pushing again, ahead of the rest.
"""
import re

import pytest

from extensions import db as _db
from models.account import AccountModel
from models.goal import GoalModel
from models.user import User
from services.account_service import AccountService
from services.goal_service import GoalService

account_svc = AccountService()
goals = GoalService()


@pytest.fixture
def savings(user):
    a = AccountModel(user_id=user.id, acct_id_str='savings-1', acct_name='Savings', balance_cents=300000)
    _db.session.add(a)
    _db.session.commit()
    return a


@pytest.fixture
def loan(user):
    a = AccountModel(user_id=user.id, acct_id_str='student-1', acct_name='Student Loan', kind='loan',
                     balance_cents=-7521700, opening_balance_cents=-7521700)
    _db.session.add(a)
    _db.session.commit()
    return a


def summary(user):
    """Each goal as (account name, position, reached, active)."""
    return [(g['account_name'], g['position'], g['reached'], g['active']) for g in goals.list_goals(user.id)]


class TestGoals:
    def test_a_goal_is_a_target_balance_on_one_of_your_accounts(self, user, savings):
        goal = goals.create_goal(user.id, {'account_id': savings.id, 'target': 7500})
        assert goals.list_goals(user.id) == [{
            'id': goal.id, 'account_id': savings.id, 'account_name': 'Savings', 'account_kind': 'bank',
            'target': 7500.0, 'target_cents': 750000, 'monthly': None, 'monthly_cents': None, 'position': 1,
            'balance': 3000.0, 'balance_cents': 300000, 'remaining_cents': 450000, 'reached': False, 'active': True,
        }]

    def test_goals_run_in_order_and_a_held_goal_that_falls_under_its_target_pushes_again(self, user, savings, loan):
        goals.create_goal(user.id, {'account_id': savings.id, 'target': 7500})
        goals.create_goal(user.id, {'account_id': loan.id, 'target': 0})
        assert summary(user) == [('Savings', 1, False, True), ('Student Loan', 2, False, False)]
        account_svc.update_account(savings.id, {'balance': 8000})          # reached: now held
        assert summary(user) == [('Savings', 1, True, False), ('Student Loan', 2, False, True)]
        account_svc.update_account(savings.id, {'balance': 7000})          # under its target again
        assert summary(user) == [('Savings', 1, False, True), ('Student Loan', 2, False, False)]

    def test_a_loan_goal_is_reached_at_nothing_owed(self, user, loan):
        goal = goals.create_goal(user.id, {'account_id': loan.id, 'target': 0})
        assert goals.list_goals(user.id)[0]['remaining_cents'] == 7521700
        account_svc.update_account(loan.id, {'balance': 0})
        assert (goals.list_goals(user.id)[0]['reached'], goal.target_cents) == (True, 0)

    def test_your_own_monthly_amount_or_the_apps_suggestion(self, user, savings):
        goal = goals.create_goal(user.id, {'account_id': savings.id, 'target': 7500, 'monthly': 500})
        assert (goal.monthly_cents, goals.list_goals(user.id)[0]['monthly']) == (50000, 500.0)
        goals.update_goal(goal.id, {'monthly': None})                      # back to the suggestion
        assert goal.monthly_cents is None

    def test_editing_the_target_and_reordering(self, user, savings, loan):
        first = goals.create_goal(user.id, {'account_id': savings.id, 'target': 7500})
        second = goals.create_goal(user.id, {'account_id': loan.id, 'target': 0})
        goals.update_goal(first.id, {'target': 8000})
        assert first.target_cents == 800000
        goals.reorder(user.id, [second.id, first.id])
        assert summary(user) == [('Student Loan', 1, False, True), ('Savings', 2, False, False)]

    def test_deleting_a_goal_closes_the_gap(self, user, savings, loan):
        first = goals.create_goal(user.id, {'account_id': savings.id, 'target': 7500})
        goals.create_goal(user.id, {'account_id': loan.id, 'target': 0})
        goals.delete_goal(first.id)
        assert summary(user) == [('Student Loan', 1, False, True)]

    def test_deleting_the_account_deletes_its_goals(self, user, savings):
        goals.create_goal(user.id, {'account_id': savings.id, 'target': 7500})
        account_svc.delete_account(savings.id)
        assert GoalModel.query.count() == 0

    @pytest.fixture
    def strangers_account(self):
        u = User(username='otheruser', email='other@example.com')
        u.set_password('otherpass')
        _db.session.add(u)
        _db.session.commit()
        a = AccountModel(user_id=u.id, acct_id_str='theirs', acct_name='Theirs')
        _db.session.add(a)
        _db.session.commit()
        return a

    @pytest.mark.parametrize('data, error', [
        ({'target': 7500}, 'Choose one of your accounts.'),
        ({'account_id': 'stranger', 'target': 7500}, 'Choose one of your accounts.'),
        ({'account_id': 99_999, 'target': 7500}, 'Choose one of your accounts.'),
        ({'account_id': 'savings'}, 'Target must be a number.'),
        ({'account_id': 'savings', 'target': 'lots'}, 'Target must be a number.'),
        ({'account_id': 'savings', 'target': 10_000_000.01}, 'Target must be between -$10,000,000 and $10,000,000.'),
        ({'account_id': 'loan', 'target': 100}, "A loan's target can't be above $0 (paid off)."),
        ({'account_id': 'savings', 'target': 7500, 'monthly': 0}, 'Monthly amount must be a number above $0.'),
        ({'account_id': 'savings', 'target': 7500, 'monthly': 'some'}, 'Monthly amount must be a number above $0.'),
    ], ids=['no-account', 'strangers-account', 'missing-account', 'no-target', 'text-target', 'target-too-high',
            'loan-target-above-zero', 'zero-monthly', 'text-monthly'])
    def test_rejects_invalid_goals(self, user, savings, loan, strangers_account, data, error):
        ids = {'savings': savings.id, 'loan': loan.id, 'stranger': strangers_account.id}
        data = {**data, **({'account_id': ids[data['account_id']]} if data.get('account_id') in ids else {})}
        with pytest.raises(ValueError, match=f'^{re.escape(error)}$'):
            goals.create_goal(user.id, data)
        assert GoalModel.query.count() == 0

    def test_reordering_needs_every_goal_once(self, user, savings, loan):
        first = goals.create_goal(user.id, {'account_id': savings.id, 'target': 7500})
        second = goals.create_goal(user.id, {'account_id': loan.id, 'target': 0})
        for ids in ([first.id], [first.id, first.id], [first.id, second.id, 99_999], 'nope'):
            with pytest.raises(ValueError, match=r'^Send every goal once, in the new order\.$'):
                goals.reorder(user.id, ids)


class TestGoalRoutes:
    def test_requires_login(self, client):
        assert client.get('/api/goals').status_code == 401

    def test_add_list_edit_reorder_and_delete(self, client, auth_headers, savings, loan):
        created = client.post('/api/goals', json={'account_id': savings.id, 'target': 7500}, headers=auth_headers)
        assert created.status_code == 201
        assert (created.json['goal']['target'], created.json['goal']['active']) == (7500.0, True)
        loan_goal = client.post('/api/goals', json={'account_id': loan.id, 'target': 0}, headers=auth_headers).json['goal']

        edited = client.patch(f"/api/goals/{created.json['goal']['id']}", json={'monthly': 450}, headers=auth_headers)
        assert (edited.status_code, edited.json['goal']['monthly']) == (200, 450.0)

        reordered = client.put('/api/goals/order', json={'goal_ids': [loan_goal['id'], created.json['goal']['id']]},
                               headers=auth_headers)
        assert [g['account_name'] for g in reordered.json['goals']] == ['Student Loan', 'Savings']

        assert client.delete(f"/api/goals/{loan_goal['id']}", headers=auth_headers).status_code == 200
        listed = client.get('/api/goals', headers=auth_headers).json['goals']
        assert [(g['account_name'], g['position']) for g in listed] == [('Savings', 1)]

    def test_an_invalid_goal_is_a_400(self, client, auth_headers, loan):
        resp = client.post('/api/goals', json={'account_id': loan.id, 'target': 100}, headers=auth_headers)
        assert (resp.status_code, resp.json) == (400, {'success': False, 'error': "A loan's target can't be above $0 (paid off)."})

    def test_another_users_goal_is_off_limits(self, client, auth_headers, user, savings):
        u = User(username='otheruser', email='other@example.com')
        u.set_password('otherpass')
        _db.session.add(u)
        _db.session.commit()
        theirs = AccountModel(user_id=u.id, acct_id_str='theirs', acct_name='Theirs', balance_cents=0)
        _db.session.add(theirs)
        _db.session.commit()
        goal = GoalModel(user_id=u.id, account_id=theirs.id, target_cents=100, position=1)
        _db.session.add(goal)
        _db.session.commit()
        assert client.patch(f'/api/goals/{goal.id}', json={'target': 5}, headers=auth_headers).status_code == 403
        assert client.delete(f'/api/goals/{goal.id}', headers=auth_headers).status_code == 403
        assert client.patch('/api/goals/99999', json={'target': 5}, headers=auth_headers).status_code == 404
        assert client.get('/api/goals', headers=auth_headers).json['goals'] == []
