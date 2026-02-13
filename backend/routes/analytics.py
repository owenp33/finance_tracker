"""
analytics.py - Analytics and reporting routes
"""
from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import DatabaseManager
from services import FinanceDataProcessor

analytics_bp = Blueprint('analytics', __name__)
db_manager = DatabaseManager()

def validate_ownership(account_id):
    """Ensure user owns the account"""
    user_id = get_jwt_identity()
    account = db_manager.get_account(account_id)
    
    if (not account) or (int(account.user_id) != int(user_id)):
        return None
    return account

@analytics_bp.route('/accounts/<int:account_id>/analytics', methods=['GET'])
@jwt_required()
def get_analytics(account_id):
    """Get comprehensive analytics for an account"""
    acc = validate_ownership(account_id)
    if not acc:
        return jsonify({'error': 'Unauthorized'}), 403
    
    transactions = db_manager.get_account_transactions(account_id)
    analytics_data = FinanceDataProcessor.generate_api_report(transactions)
    
    return jsonify(analytics_data), 200