"""
analytics.py - Analytics and reporting routes
"""
from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required
from services import DbService, AnalyticsService
from middleware.ownership import owns_account

analytics_bp = Blueprint('analytics', __name__)
db_service = DbService()


@analytics_bp.route('/all', methods=['GET'])
@jwt_required()
def get_all_analytics():
    """Get analytics aggregated across all accounts for the current user"""
    from flask_jwt_extended import get_jwt_identity
    user_id = get_jwt_identity()
    transactions = db_service.get_all_user_transactions(user_id)
    analytics_data = AnalyticsService.generate_report(transactions)
    return jsonify({'success': True, **analytics_data}), 200


@analytics_bp.route('/<int:account_id>', methods=['GET'])
@jwt_required()
@owns_account
def get_analytics(account_id):
    """Get comprehensive analytics for a single account"""
    transactions = db_service.get_account_transactions(account_id)
    analytics_data = AnalyticsService.generate_report(transactions)
    return jsonify({'success': True, **analytics_data}), 200