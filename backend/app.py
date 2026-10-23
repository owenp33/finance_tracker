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


def _run_migrations(db):
    """Apply schema changes made after initial creation (create_all never alters existing tables)."""
    from sqlalchemy import text
    with db.engine.connect() as conn:
        migrations = [
            'ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_transfer BOOLEAN NOT NULL DEFAULT FALSE',
            'ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_peer_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL',
            'ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_reimbursement BOOLEAN NOT NULL DEFAULT FALSE',
            'ALTER TABLE transactions ADD COLUMN IF NOT EXISTS recurring_index INTEGER',
            'ALTER TABLE users ALTER COLUMN password_hash TYPE VARCHAR(255)',
            'ALTER TABLE accounts ALTER COLUMN acct_id_str TYPE VARCHAR(100)',
            'ALTER TABLE accounts ALTER COLUMN acct_name TYPE VARCHAR(100)',
            'ALTER TABLE accounts ADD COLUMN IF NOT EXISTS needs_attention BOOLEAN NOT NULL DEFAULT FALSE',
        ]
        for sql in migrations:
            conn.execute(text(sql))

        # Backfill recurring_index for rows generated before this column existed,
        # so existing recurring chips show the correct occurrence number.
        conn.execute(text('''
            UPDATE transactions t
            SET recurring_index = sub.rn
            FROM (
                SELECT id, ROW_NUMBER() OVER (PARTITION BY recurring_id ORDER BY date ASC, id ASC) AS rn
                FROM transactions
                WHERE recurring_id IS NOT NULL
            ) sub
            WHERE t.id = sub.id AND t.recurring_index IS NULL
        '''))
        conn.commit()


def create_app(test_config=None):
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
    app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(hours=24)

    if test_config:
        app.config.update(test_config)

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
    from routes.imports import import_bp
    from routes.health import health_bp
    from routes.budgets import budgets_bp
    from routes.export import export_bp

    app.register_blueprint(health_bp)
    app.register_blueprint(auth_bp, url_prefix='/api/auth')
    app.register_blueprint(accounts_bp, url_prefix='/api/accounts')
    app.register_blueprint(transactions_bp, url_prefix='/api/transactions')
    app.register_blueprint(recurring_bp, url_prefix='/api/recurring')
    app.register_blueprint(analytics_bp, url_prefix='/api/analytics')
    app.register_blueprint(import_bp, url_prefix='/api/import')
    app.register_blueprint(budgets_bp, url_prefix='/api/budgets')
    app.register_blueprint(export_bp, url_prefix='/api/export')

    from middleware.error_handlers import register_error_handlers
    register_error_handlers(app)

    with app.app_context():
        db.create_all()
        if not app.config.get('TESTING'):
            _run_migrations(db)

    if not app.config.get('TESTING'):
        from services.scheduler import init_scheduler
        init_scheduler(app)

    return app


if __name__ == '__main__':
    app = create_app()
    print("Database tables created")
    print("Server running on http://localhost:5000")
    # Localhost only: the React dev server proxies /api here, so visitors on the
    # network (dev.ps1 -Lan) or through ngrok never need to reach Flask directly
    app.run(debug=True, port=5000, host='127.0.0.1', use_reloader=False)