"""
transactions.py - Transaction CRUD routes
Routes are intentionally thin: extract input, call a service, return a response.
No ORM queries, data coercion, or business logic should live here.
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from extensions import db
from services import DbService, AccountService
from middleware.ownership import owns_transaction

transactions_bp = Blueprint('transactions', __name__)
db_service = DbService()
account_service = AccountService()


@transactions_bp.route('/<int:transaction_id>', methods=['GET'])
@jwt_required()
@owns_transaction
def get_transaction(transaction_id):
    """Fetch a single transaction by ID."""
    trans = db_service.get_transaction(transaction_id)
    return jsonify({'success': True, 'transaction': trans.to_dict()}), 200


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


@transactions_bp.route('/<int:transaction_id>/transfer', methods=['PATCH'])
@jwt_required()
@owns_transaction
def toggle_transfer(transaction_id):
    """
    Toggle the transfer flag on a transaction.

    Turning ON:  marks is_transfer=True, then searches for an unlinked peer
                 transaction with the opposite amount in a different account.
                 If one is found the two are linked automatically.
    Turning OFF: clears is_transfer and removes the peer link on both sides.
    """
    user_id = get_jwt_identity()
    trans   = db_service.get_transaction(transaction_id)

    if trans.is_transfer:
        success, error = account_service.unlink_transfer(transaction_id)
    else:
        peer = db_service.find_transfer_peer(
            user_id, trans.amount_cents, trans.date, trans.account_id, exclude_id=transaction_id
        )
        if peer:
            success, error = account_service.link_transfer(transaction_id, peer.id)
        else:
            trans.is_transfer = True
            db.session.commit()
            success, error = True, None

    if not success:
        return jsonify({'success': False, 'error': error}), 400

    trans = db_service.get_transaction(transaction_id)
    return jsonify({'success': True, 'transaction': trans.to_dict()}), 200


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