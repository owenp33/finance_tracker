"""
auth.py - Authentication routes
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from services import DbService, AccountService, AuthService
from services.auth_service import RegistrationConflict

auth_bp = Blueprint('auth', __name__)
db_service = DbService()
account_service = AccountService()
auth_service = AuthService()


@auth_bp.route('/register', methods=['POST'])
def register():
    """Register a new user. 400 for invalid input, 409 when the username or email is taken."""
    data = request.get_json(silent=True)
    data = data if isinstance(data, dict) else {}

    try:
        user = auth_service.register(data.get('username'), data.get('email'), data.get('password'))
    except RegistrationConflict as e:
        return jsonify({'success': False, 'error': str(e)}), 409
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400

    return jsonify({
        'success': True,
        'user': user.to_dict(),
        'access_token': auth_service.issue_token(user)
    }), 201


@auth_bp.route('/login', methods=['POST'])
def login():
    """Login and process any due recurring transactions"""
    data = request.get_json()

    if not data.get('username') or not data.get('password'):
        return jsonify({'success': False, 'error': 'Missing credentials'}), 400

    user = auth_service.authenticate(data['username'], data['password'])

    if not user:
        return jsonify({'success': False, 'error': 'Invalid credentials'}), 401

    access_token = auth_service.issue_token(user)

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
    """Get current authenticated user info and generate any due recurring transactions."""
    user_id = get_jwt_identity()
    user = db_service.get_user_by_id(user_id)

    if not user:
        return jsonify({'success': False, 'error': 'User not found'}), 404

    for account in db_service.get_user_accounts(user.id):
        try:
            account_service.process_due_recurring(account.id)
        except Exception:
            pass  # don't block page load if generation fails for one account

    return jsonify({'success': True, 'user': user.to_dict()}), 200