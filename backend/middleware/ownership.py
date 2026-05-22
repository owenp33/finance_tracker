"""
ownership.py - Account and resource ownership middleware
"""
from functools import wraps
from flask import jsonify
from flask_jwt_extended import get_jwt_identity
from services import DbService

db_service = DbService()


def owns_account(f):
    """Verify the current user owns the account_id in the URL"""
    @wraps(f)
    def decorated(*args, **kwargs):
        account_id = kwargs.get('account_id')
        user_id = get_jwt_identity()
        account = db_service.get_account(account_id)

        if (not account) or (int(account.user_id) != int(user_id)):
            return jsonify({'success': False, 'error': 'Unauthorized'}), 403

        return f(*args, **kwargs)
    return decorated


def owns_recurring(f):
    """Verify the current user owns the recurring_id in the URL"""
    @wraps(f)
    def decorated(*args, **kwargs):
        recurring_id = kwargs.get('recurring_id')
        user_id = get_jwt_identity()
        recurring = db_service.get_recurring(recurring_id)

        if not recurring:
            return jsonify({'success': False, 'error': 'Recurring transaction not found'}), 404

        if int(recurring.account.user_id) != int(user_id):
            return jsonify({'success': False, 'error': 'Unauthorized'}), 403

        return f(*args, **kwargs)
    return decorated


def owns_transaction(f):
    """Verify the current user owns the transaction_id in the URL"""
    @wraps(f)
    def decorated(*args, **kwargs):
        transaction_id = kwargs.get('transaction_id')
        user_id = get_jwt_identity()
        transaction = db_service.get_transaction(transaction_id)

        if not transaction:
            return jsonify({'success': False, 'error': 'Transaction not found'}), 404

        if int(transaction.account.user_id) != int(user_id):
            return jsonify({'success': False, 'error': 'Unauthorized'}), 403

        return f(*args, **kwargs)
    return decorated


def owns_budget(f):
    """Verify the current user owns the budget_id in the URL"""
    @wraps(f)
    def decorated(*args, **kwargs):
        budget_id = kwargs.get('budget_id')
        user_id = get_jwt_identity()
        budget = db_service.get_budget(budget_id)

        if not budget:
            return jsonify({'success': False, 'error': 'Budget not found'}), 404

        if int(budget.user_id) != int(user_id):
            return jsonify({'success': False, 'error': 'Unauthorized'}), 403

        return f(*args, **kwargs)
    return decorated