"""
goal_service.py - Goals: target balances on the user's accounts, run in order

A goal is reached when its account's balance is at or past its target (a loan's target is at most
$0, paid off), and held from then on; the first goal in order that isn't reached is the active one.
So a held goal that falls under its target is pushing again, ahead of the goals after it, and the
next goal takes over once the one before is reached. Nothing about that is stored: it's worked out
from the balances each time. A goal may carry the user's own monthly amount; without one, the app
suggests one (the frontend, from the forecast).
"""
import math
import numbers
from extensions import db
from models.goal import GoalModel
from services.account_service import balance_dollars, MAX_BALANCE
from services.db_service import DbService

db_service = DbService()


def _cents(dollars):
    return int(round(dollars * 100))


def _users_account(user_id, account_id):
    """One of the user's accounts. Raises ValueError otherwise."""
    account = None
    if isinstance(account_id, int) and not isinstance(account_id, bool):
        account = db_service.get_account(account_id)
    if account is None or int(account.user_id) != int(user_id):
        raise ValueError('Choose one of your accounts.')
    return account


def _target_cents(account, value):
    """A goal's target for this account, in cents. Raises ValueError for a bad one, or a loan's above $0."""
    cents = _cents(balance_dollars(value, 'Target'))
    if account.kind == 'loan' and cents > 0:
        raise ValueError("A loan's target can't be above $0 (paid off).")
    return cents


def _monthly_cents(value):
    """The user's own monthly amount, in cents, or None (the app's suggestion). Raises ValueError for a bad one."""
    if value is None:
        return None
    if (isinstance(value, bool) or not isinstance(value, numbers.Real) or not math.isfinite(value)
            or not 0 < value <= MAX_BALANCE):
        raise ValueError('Monthly amount must be a number above $0.')
    return _cents(value)


class GoalService:

    def list_goals(self, user_id):
        """The user's goals in order, each with its account's balance and its status (goal_dict)."""
        goals = db_service.get_user_goals(user_id)
        reached = {g.id: g.account.balance_cents >= g.target_cents for g in goals}
        active = next((g.id for g in goals if not reached[g.id]), None)
        return [self._goal_dict(g, reached[g.id], g.id == active) for g in goals]

    def goal_dict(self, user_id, goal_id):
        """One goal as list_goals gives it."""
        return next(g for g in self.list_goals(user_id) if g['id'] == goal_id)

    def create_goal(self, user_id, data):
        """
        Add a goal at the end of the order: account_id (one of the user's accounts), target
        (dollars; a loan's at most 0) and, optionally, monthly (dollars above 0). Raises ValueError
        for anything invalid, before changing anything.
        """
        account = _users_account(user_id, data.get('account_id'))
        target = _target_cents(account, data.get('target'))
        monthly = _monthly_cents(data.get('monthly'))
        goal = GoalModel(user_id=int(user_id), account_id=account.id, target_cents=target, monthly_cents=monthly,
                         position=len(db_service.get_user_goals(user_id)) + 1)
        db.session.add(goal)
        db.session.commit()
        return goal

    def update_goal(self, goal_id, data):
        """
        Change a goal's target and/or its monthly amount (None goes back to the app's suggestion).
        Raises ValueError for anything invalid, before changing anything.
        """
        goal = db_service.get_goal(goal_id)
        target = _target_cents(goal.account, data['target']) if 'target' in data else goal.target_cents
        monthly = _monthly_cents(data['monthly']) if 'monthly' in data else goal.monthly_cents
        goal.target_cents, goal.monthly_cents = target, monthly
        db.session.commit()
        return goal

    def reorder(self, user_id, goal_ids):
        """Put the user's goals in this order (every goal's id once). Raises ValueError otherwise."""
        goals = {g.id: g for g in db_service.get_user_goals(user_id)}
        if (not isinstance(goal_ids, list) or len(goal_ids) != len(goals) or set(goal_ids) != set(goals)
                or len(set(goal_ids)) != len(goal_ids)):
            raise ValueError('Send every goal once, in the new order.')
        for position, goal_id in enumerate(goal_ids, start=1):
            goals[goal_id].position = position
        db.session.commit()

    def delete_goal(self, goal_id):
        """Delete a goal; the ones after it move up."""
        goal = db_service.get_goal(goal_id)
        user_id = goal.user_id
        db.session.delete(goal)
        db.session.flush()
        for position, other in enumerate(db_service.get_user_goals(user_id), start=1):
            other.position = position
        db.session.commit()

    @staticmethod
    def _goal_dict(goal, reached, active):
        account = goal.account
        return {
            'id': goal.id,
            'account_id': account.id,
            'account_name': account.acct_name,
            'account_kind': account.kind,
            'target': goal.target_cents / 100,
            'target_cents': goal.target_cents,
            'monthly': None if goal.monthly_cents is None else goal.monthly_cents / 100,
            'monthly_cents': goal.monthly_cents,
            'position': goal.position,
            'balance': account.balance,
            'balance_cents': account.balance_cents,
            'remaining_cents': max(goal.target_cents - account.balance_cents, 0),
            'reached': reached,
            'active': active,
        }
