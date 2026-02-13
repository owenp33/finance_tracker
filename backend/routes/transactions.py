"""
transactions.py - Transaction CRUD routes
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from datetime import datetime
from models import DatabaseManager, TransactionModel

transactions_bp = Blueprint('transactions', __name__)
db_manager = DatabaseManager()

@transactions_bp.route('/<int:transaction_id>', methods=['PUT', 'PATCH'])
@jwt_required()
def update_transaction(transaction_id):
    """Update an existing transaction"""
    user_id = get_jwt_identity()
    
    transaction = TransactionModel.query.get(transaction_id)
    
    if not transaction:
        return jsonify({'error': 'Transaction not found'}), 404
    
    if int(transaction.account.user_id) != int(user_id):
        return jsonify({'error': 'Unauthorized'}), 403
    
    data = request.get_json()
    
    # Build update kwargs
    update_fields = {}
    if 'date' in data:
        update_fields['date'] = datetime.fromisoformat(data['date']).date()
    if 'vendor' in data:
        update_fields['vendor'] = data['vendor']
    if 'category' in data:
        update_fields['category'] = data['category']
    if 'amount' in data:
        update_fields['amount'] = float(data['amount'])
    if 'notes' in data:
        update_fields['notes'] = data['notes']
    
    try:
        updated = db_manager.update_transaction(transaction_id, **update_fields)
        
        return jsonify({
            'transaction': updated.to_dict(),
            'new_balance': transaction.account.balance
        }), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@transactions_bp.route('/<int:transaction_id>', methods=['DELETE'])
@jwt_required()
def delete_transaction(transaction_id):
    """Delete a transaction"""
    user_id = get_jwt_identity()
    
    transaction = TransactionModel.query.get(transaction_id)
    
    if not transaction:
        return jsonify({'error': 'Transaction not found'}), 404
    
    if int(transaction.account.user_id) != int(user_id):
        return jsonify({'error': 'Unauthorized'}), 403
    
    account_id = transaction.account_id
    success = db_manager.delete_transaction(transaction_id)
    
    if success:
        return jsonify({
            'message': 'Transaction deleted',
            'new_balance': db_manager.get_account(account_id).balance
        }), 200
        
    return jsonify({'error': 'Failed to delete'}), 400