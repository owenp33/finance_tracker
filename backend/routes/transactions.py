"""
transactions.py - Transaction CRUD routes

Routes are intentionally thin: extract input, call a service, return a response.
No ORM queries, data coercion, or business logic should live here.
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from services.account_service import AccountService
from services.db_service import DbService

transactions_bp = Blueprint('transactions', __name__)
account_service = AccountService()
db_service = DbService()

@transactions_bp.route('/<int:transaction_id>', methods=['PUT', 'PATCH'])
@jwt_required()
def update_transaction(transaction_id):
    """Update an existing transaction"""
    user_id = get_jwt_identity()
    data = request.get_json()

    transaction, error, status = account_service.get_transaction_authorized(transaction_id, user_id)
    if error:
        return jsonify({'success': False, 'error': error}), status

    updated, error = account_service.update_transaction(transaction_id, data)
    if error:
        return jsonify({'success': False, 'error': error}), 400

    return jsonify({
        'success': True,
        'transaction': updated.to_dict(),
        'new_balance': transaction.account.balance
    }), 200


@transactions_bp.route('/<int:transaction_id>', methods=['DELETE'])
@jwt_required()
def delete_transaction(transaction_id):
    """Delete a transaction"""
    user_id = get_jwt_identity()

    transaction, error, status = account_service.get_transaction_authorized(transaction_id, user_id)
    if error:
        return jsonify({'success': False, 'error': error}), status

    account_id = transaction.account_id
    success, error = account_service.delete_transaction(transaction_id)
    if not success:
        return jsonify({'success': False, 'error': error}), 400

    account = db_service.get_account(account_id)
    return jsonify({
        'success': True,
        'message': 'Transaction deleted',
        'new_balance': account.balance
    }), 200