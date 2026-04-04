"""
transactions.py - Transaction CRUD routes
Routes are intentionally thin: extract input, call a service, return a response.
No ORM queries, data coercion, or business logic should live here.
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from services import DbService, AccountService
from middleware.ownership import owns_transaction

transactions_bp = Blueprint('transactions', __name__)
db_service = DbService()
account_service = AccountService()


@transactions_bp.route('/<int:transaction_id>', methods=['PUT', 'PATCH'])
@jwt_required()
@owns_transaction
def update_transaction(transaction_id):
    """Update an existing transaction"""
    data = request.get_json()
    updated, error = account_service.update_transaction(transaction_id, data)

    if error:
        return jsonify({'success': False, 'error': error}), 400

    return jsonify({
        'success': True,
        'transaction': updated.to_dict(),
        'new_balance': updated.account.balance
    }), 200


@transactions_bp.route('/<int:transaction_id>', methods=['DELETE'])
@jwt_required()
@owns_transaction
def delete_transaction(transaction_id):
    """Delete a transaction"""
    transaction = db_service.get_transaction(transaction_id)
    account_id = transaction.account_id

    account_service.delete_transaction(transaction_id)
    account = db_service.get_account(account_id)

    return jsonify({
        'success': True,
        'message': 'Transaction deleted',
        'new_balance': account.balance
    }), 200