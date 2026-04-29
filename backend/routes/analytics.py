"""
analytics.py - Analytics and reporting routes
"""
from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required
from services import DbService, AnalyticsService
from middleware.ownership import owns_account

analytics_bp = Blueprint('analytics', __name__)
db_service = DbService()


@analytics_bp.route('/<int:account_id>', methods=['GET'])
@jwt_required()
@owns_account
def get_analytics(account_id):
    """Get comprehensive analytics for an account"""
    transactions = db_service.get_account_transactions(account_id)
    analytics_data = AnalyticsService.generate_report(transactions)

    return jsonify({'success': True, **analytics_data}), 200