"""
auth.py - Authentication routes
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity
from datetime import timedelta
from services import DbService, AccountService

from extensions import db as auth_db
print(f"auth.py db id: {id(auth_db)}")  # ADD THIS

auth_bp = Blueprint('auth', __name__)
db_service = DbService()
account_service = AccountService()


@auth_bp.route('/register', methods=['POST'])
def register():
    """Register new user"""
    data = request.get_json()
    user = db_service.create_user(data['username'], data['email'], data['password'])
    return jsonify({
        'success': True,
        'user': user.to_dict(),
        'access_token': create_access_token(identity=user.id)
    }), 201


@auth_bp.route('/login', methods=['POST'])
def login():
    """Login and process any due recurring transactions"""
    data = request.get_json()

    if not data.get('username') or not data.get('password'):
        return jsonify({'success': False, 'error': 'Missing credentials'}), 400

    user = db_service.authenticate_user(data['username'], data['password'])

    if not user:
        return jsonify({'success': False, 'error': 'Invalid credentials'}), 401

    access_token = create_access_token(
        identity=str(user.id),
        expires_delta=timedelta(hours=24)
    )

    total_generated = 0
    for account in db_service.get_user_accounts(user.id):
        total_generated += account_service.process_due_recurring(account.id)

    return jsonify({
        'success': True,
        'access_token': access_token,
        'user': user.to_dict(),
        'updates': {
            'transactions_generated': total_generated
        }
    }), 200


@auth_bp.route('/me', methods=['GET'])
@jwt_required()
def get_current_user():
    """Get current authenticated user info"""
    user_id = get_jwt_identity()
    user = db_service.get_user_by_id(user_id)

    if not user:
        return jsonify({'success': False, 'error': 'User not found'}), 404

    return jsonify({'success': True, 'user': user.to_dict()}), 200