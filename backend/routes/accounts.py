"""
accounts.py - Account management routes
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import DatabaseManager

accounts_bp = Blueprint('accounts', __name__)
db_manager = DatabaseManager()

def validate_ownership(account_id):
    """Utility to ensure the JWT user actually owns the account"""
    user_id = get_jwt_identity()
    account = db_manager.get_account(account_id)
    
    if (not account) or (int(account.user_id) != int(user_id)):
        return None
    return account

@accounts_bp.route('', methods=['GET'])
@jwt_required()
def get_accounts():
    """Get all bank accounts for current user"""
    user_id = get_jwt_identity()
    accounts = db_manager.get_user_accounts(user_id)
    
    return jsonify({
        'accounts': [acc.to_dict() for acc in accounts]
    }), 200

@accounts_bp.route('', methods=['POST'])
@jwt_required()
def create_account():
    """Create new account for current user"""
    user_id = get_jwt_identity()
    data = request.get_json()
    
    if not data.get('account_id'):
        return jsonify({'error': 'account_id is required'}), 400
    
    try:
        account = db_manager.create_account(
            user_id=user_id,
            acct_id_str=data['account_id'],
            account_name=data.get('account_name', data['account_id'])
        )
        return jsonify({'account': account.to_dict()}), 201
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@accounts_bp.route('/<int:account_id>', methods=['GET'])
@jwt_required()
def get_account(account_id):
    """Get specific account details"""
    acc = validate_ownership(account_id)
    if not acc:
        return jsonify({'error': 'Unauthorized or account not found'}), 403
        
    return jsonify(acc.to_dict()), 200

@accounts_bp.route('/<int:account_id>/transactions', methods=['GET'])
@jwt_required()
def get_transactions(account_id):
    """Get all transactions for an account"""
    if not validate_ownership(account_id):
        return jsonify({'error': 'Unauthorized'}), 403
    
    transactions = db_manager.get_account_transactions(account_id)
    
    return jsonify({
        'transactions': [t.to_dict() for t in transactions]
    }), 200

@accounts_bp.route('/<int:account_id>/transactions', methods=['POST'])
@jwt_required()
def add_transaction(account_id):
    """Add a new transaction to an account"""
    from datetime import datetime
    
    if not validate_ownership(account_id):
        return jsonify({'error': 'Unauthorized'}), 403
    
    data = request.get_json()
    
    # Validate required fields
    required = ['date', 'vendor', 'category', 'amount']
    if not all(k in data for k in required):
        return jsonify({'error': f'Missing required fields: {required}'}), 400
    
    try:
        transaction = db_manager.add_transaction(
            account_id=account_id,
            date_obj=datetime.fromisoformat(data['date']).date(),
            vendor=data['vendor'],
            category=data['category'],
            amount=float(data['amount']),
            notes=data.get('notes', '')
        )
        
        acc = db_manager.get_account(account_id)
        
        return jsonify({
            'transaction': transaction.to_dict(),
            'new_balance': acc.balance
        }), 201
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@accounts_bp.route('/<int:account_id>/recurring', methods=['GET'])
@jwt_required()
def get_recurring(account_id):
    """Get all recurring transactions for an account"""
    if not validate_ownership(account_id):
        return jsonify({'error': 'Unauthorized'}), 403
    
    recurring = db_manager.get_account_recurring(account_id)
    
    return jsonify({
        'recurring': [r.to_dict() for r in recurring]
    }), 200

@accounts_bp.route('/<int:account_id>/recurring', methods=['POST'])
@jwt_required()
def add_recurring(account_id):
    """Add a new recurring transaction template"""
    from datetime import datetime
    
    if not validate_ownership(account_id):
        return jsonify({'error': 'Unauthorized'}), 403
    
    data = request.get_json()
    
    required = ['start_date', 'vendor', 'category', 'amount', 'frequency']
    if not all(k in data for k in required):
        return jsonify({'error': f'Missing required fields: {required}'}), 400
    
    try:
        start_date = datetime.fromisoformat(data['start_date']).date()
        next_date = datetime.fromisoformat(data['next_date']).date() if 'next_date' in data else start_date
        
        recurring = db_manager.add_recurring(
            account_id=account_id,
            start_date=start_date,
            vendor=data['vendor'],
            category=data['category'],
            amount=float(data['amount']),
            next_date=next_date,
            frequency=int(data['frequency']),
            number=int(data.get('number', -1)),
            notes=data.get('notes', '')
        )
        
        return jsonify({'recurring': recurring.to_dict()}), 201
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400