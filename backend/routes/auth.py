"""
auth.py - Authentication routes
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity
from datetime import timedelta
import json
from models import DatabaseManager

auth_bp = Blueprint('auth', __name__)
db_manager = DatabaseManager()

@auth_bp.route('/register', methods=['POST'])
def register():
    """Register new user"""
    data = request.get_json()
    try:
        user = db_manager.create_user(data['username'], data['email'], data['password'])
        return jsonify({
            'user': user.to_dict(),
            'access_token': create_access_token(identity=user.id)
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@auth_bp.route('/login', methods=['POST'])
def login():
    """Login and process any due recurring transactions"""
    data = request.get_json()
    
    if not data.get('username') or not data.get('password'):
        return jsonify({'error': 'Missing credentials'}), 400
    
    user = db_manager.authenticate_user(data['username'], data['password'])
    
    if not user:
        return jsonify({'error': 'Invalid credentials'}), 401
    
    access_token = create_access_token(
        identity=str(user.id),
        expires_delta=timedelta(hours=24)
    )
    
    # Process recurring transactions for all user accounts
    total_generated = 0
    accounts = db_manager.get_user_accounts(user.id)
    
    for account in accounts:
        generated = db_manager.process_due_recurring(account.id)
        total_generated += generated
    
    return jsonify({
        'access_token': access_token,
        'user': json.dumps(user.to_dict()),
        'updates': {
            'transactions_generated': total_generated
        }
    }), 200

@auth_bp.route('/me', methods=['GET'])
@jwt_required()
def get_current_user():
    """Get current authenticated user info"""
    user_id = get_jwt_identity()
    user = db_manager.get_user_by_id(user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
        
    return jsonify(user.to_dict()), 200