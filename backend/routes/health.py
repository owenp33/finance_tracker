"""
health.py - Health check and API info routes
"""
from flask import Blueprint, jsonify
from datetime import datetime, timezone

health_bp = Blueprint('health', __name__)

@health_bp.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'database': 'connected',
        'timestamp': datetime.now(timezone.utc).isoformat()
    }), 200

@health_bp.route('/', methods=['GET'])
def home():
    """API home - lists available endpoints"""
    return jsonify({
        'name': 'Finance Tracker API',
        'version': '1.0',
        'endpoints': {
            'auth': '/api/auth/{register,login,me}',
            'accounts': '/api/accounts',
            'transactions': '/api/accounts/:id/transactions',
            'recurring': '/api/accounts/:id/recurring',
            'analytics': '/api/accounts/:id/analytics',
            'import': '/api/accounts/:id/import-csv'
        }
    }), 200