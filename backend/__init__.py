"""
__init__.py - Flask application factory

This centralizes app initialization for better testing and deployment.
"""

from flask import Flask
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from datetime import timedelta
import os

def create_app(config=None):
    """Application factory pattern"""
    app = Flask(__name__)
    
    # Configuration
    app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv(
        'DATABASE_URL', 
        'postgresql://postgres:password@localhost:5432/finance_app'
    )
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', 'dev-secret-key')
    app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(days=7)
    
    # Override with custom config if provided
    if config:
        app.config.update(config)
    
    # Initialize extensions
    from models import db
    db.init_app(app)
    
    CORS(app, resources={r"/api/*": {"origins": "http://localhost:3000"}})
    JWTManager(app)
    
    # Register blueprints (if you want to organize routes)
    # from .routes import auth_bp, accounts_bp
    # app.register_blueprint(auth_bp)
    # app.register_blueprint(accounts_bp)
    
    # Create tables
    with app.app_context():
        db.create_all()
        print("Database tables ready")
    
    return app