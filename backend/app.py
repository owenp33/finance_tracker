"""
app.py - Flask Application Factory
Creates and configures the Flask app with all extensions.
"""
import os
from dotenv import load_dotenv
load_dotenv()

from flask import Flask, request
from flask_cors import CORS
from datetime import timedelta


def create_app():
    """Application factory pattern"""
    app = Flask(__name__)

    # CONFIGURATION
    app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv(
        'DATABASE_URL',
        'postgresql://postgres:password@localhost:5432/finance_app'
    )
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {'pool_pre_ping': True}
    app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', 'dev-secret-key-change-in-production')
    app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(days=7)

    # Initialize extensions from single source
    from extensions import db, jwt
    db.init_app(app)
    jwt.init_app(app)

    allowed_origins = [
        "http://localhost:3000",
        os.getenv("FRONTEND_URL", "")
    ]
    CORS(app, supports_credentials=True)
    
    @app.after_request
    def add_cors_headers(response):
        origin = request.headers.get('Origin')
        if origin in allowed_origins:
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
            response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
            response.headers['Access-Control-Allow-Credentials'] = 'true'
        return response

    # Register blueprints
    from routes.auth import auth_bp
    from routes.accounts import accounts_bp
    from routes.transactions import transactions_bp
    from routes.recurring import recurring_bp
    from routes.analytics import analytics_bp
    from routes.csv_import import csv_bp
    from routes.health import health_bp
    from routes.budgets import budgets_bp

    app.register_blueprint(health_bp)
    app.register_blueprint(auth_bp, url_prefix='/api/auth')
    app.register_blueprint(accounts_bp, url_prefix='/api/accounts')
    app.register_blueprint(transactions_bp, url_prefix='/api/transactions')
    app.register_blueprint(recurring_bp, url_prefix='/api/recurring')
    app.register_blueprint(analytics_bp, url_prefix='/api/analytics')
    app.register_blueprint(csv_bp, url_prefix='/api/csv')
    app.register_blueprint(budgets_bp, url_prefix='/api/budgets')

    from middleware.error_handlers import register_error_handlers
    register_error_handlers(app)

    with app.app_context():
        db.create_all()

    if not app.config.get('TESTING'):
        from services.scheduler import init_scheduler
        init_scheduler(app)

    return app


if __name__ == '__main__':
    app = create_app()
    print("Database tables created")
    print("Server running on http://localhost:5000")
    app.run(debug=True, port=5000, host='0.0.0.0', use_reloader=False)