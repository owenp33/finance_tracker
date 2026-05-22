"""
Routes package - All API blueprints
"""
from routes.auth import auth_bp
from routes.accounts import accounts_bp
from routes.transactions import transactions_bp
from routes.recurring import recurring_bp
from routes.analytics import analytics_bp
from routes.csv_import import csv_bp
from routes.health import health_bp

blueprints = [
    health_bp,
    auth_bp,
    accounts_bp,
    transactions_bp,
    recurring_bp,
    analytics_bp,
    csv_bp
]

__all__ = ['blueprints']