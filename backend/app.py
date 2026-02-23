"""
app.py - Flask Application Factory

Creates and configures the Flask app with all extensions.
This is the ONLY place db should be initialized.
"""
import os
from dotenv import load_dotenv
load_dotenv()

import os
from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from datetime import timedelta

# Initialize extensions (but don't bind to app yet)
db = SQLAlchemy()
jwt = JWTManager()

def create_app():
    """Application factory pattern"""
    app = Flask(__name__)
    
    # CONFIGURATION
    app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv(
        'DATABASE_URL',
        'postgresql://postgres:password@localhost:5432/finance_app'
    )
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', 'dev-secret-key-change-in-production')
    app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(days=7)
    
    # Initialize extensions with app
    db.init_app(app)
    jwt.init_app(app)
    
    allowed_origins = [
        "http://localhost:3000",
        os.getenv("FRONTEND_URL", "")   # Set FRONTEND_URL in .env to ngrok URL
    ]
    
    CORS(app, 
         resources={r"/api/*": {"origins": [o for o in allowed_origins if o]}}, #["http://localhost:3000", r"https://.*\.ngrok-free\.dev"]}},  # 
         supports_credentials=True)
    
    # Register blueprints
    from routes.auth import auth_bp
    from routes.accounts import accounts_bp
    from routes.transactions import transactions_bp
    from routes.recurring import recurring_bp
    from routes.analytics import analytics_bp
    from routes.csv_import import csv_bp
    from routes.health import health_bp
    
    app.register_blueprint(health_bp)
    app.register_blueprint(auth_bp, url_prefix='/api/auth')
    app.register_blueprint(accounts_bp, url_prefix='/api/accounts')
    app.register_blueprint(transactions_bp, url_prefix='/api/transactions')
    app.register_blueprint(recurring_bp, url_prefix='/api/recurring')
    app.register_blueprint(analytics_bp, url_prefix='/api/analytics')
    app.register_blueprint(csv_bp, url_prefix='/api/csv')
    
    from middleware.error_handlers import register_error_handlers
    register_error_handlers(app)
    
    # Create tables on first run
    with app.app_context():
        db.create_all()
    
    return app

if __name__ == '__main__':
    app = create_app()
    print("Database tables created")
    print("Server running on http://localhost:5000")
    app.run(debug=True, port=5000, host='0.0.0.0')
