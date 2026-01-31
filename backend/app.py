import os
import sys
from datetime import datetime, date, timedelta, timezone
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_jwt_extended import (
    JWTManager, create_access_token, jwt_required, get_jwt_identity
)

from models import db, DatabaseManager, TransactionModel, RecurringModel
from accounts import FinanceDataProcessor

app = Flask(__name__)
# CONFIGURATION ============================================================
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv(
    'DATABASE_URL',
    'postgresql://postgres:password@localhost:5432/finance_app'
)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', 'dev-secret-key-change-in-production') # secret key here
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(days=7)

# INITIALIZE EXTENSIONS ====================================================
db.init_app(app)
CORS(app, resources={r"/api/*": {"origins": "http://localhost:3000"}}, supports_credentials=True)
jwt = JWTManager(app)

# Create DatabaseManager instance
db_manager = DatabaseManager()

# HELPER FUNCTIONS ===========================================================
def validate_ownership(account_id):
    """Utility to ensure the JWT user actually owns the account they are requesting"""
    user_id = get_jwt_identity()
    account = db_manager.get_account(account_id)
    if not account or account.user_id != user_id:
        return None
    return account

# HEALTH CHECK =============================================================
@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'database': 'connected',
        'timestamp': datetime.now(timezone.utc).isoformat()
    }), 200

@app.route('/', methods=['GET'])
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

# AUTH ENDPOINTS =======================================================
@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json()
    try:
        user = db_manager.create_user(data['username'], data['email'], data['password'])
        return jsonify({
            'user': user.to_dict(),
            'access_token': create_access_token(identity=user.id)
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/auth/login', methods=['POST'])
def login():
    """Login and process any due recurring transactions"""
    data = request.get_json()
    
    if not data.get('username') or not data.get('password'):
        return jsonify({'error': 'Missing credentials'}), 400
    
    user = db_manager.authenticate_user(data['username'], data['password'])
    
    if not user:
        return jsonify({'error': 'Invalid credentials'}), 401
    
    # Process recurring transactions for all user accounts
    total_generated = 0
    accounts = db_manager.get_user_accounts(user.id)
    
    for account in accounts:
        generated = db_manager.process_due_recurring(account.id)
        total_generated += generated
    
    return jsonify({
        'user': user.to_dict(),
        'access_token': create_access_token(identity=user.id),
        'updates': {
            'transactions_generated': total_generated
        }
    }), 200
    
@app.route('/api/auth/me', methods=['GET'])
@jwt_required()
def get_current_user():
    """Get current authenticated user info"""
    user_id = get_jwt_identity()
    user = db_manager.get_user_by_id(user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
        
    return jsonify(user.to_dict()), 200

# ACCOUNT ENDPOINTS =================================================
@app.route('/api/accounts', methods=['GET'])
@jwt_required()
def get_accounts():
    """Get all bank accounts for current user"""
    user_id = get_jwt_identity()
    accounts = db_manager.get_user_accounts(user_id)
    
    return jsonify({
        'accounts': [acc.to_dict() for acc in accounts]
    }), 200

@app.route('/api/accounts', methods=['POST'])
@jwt_required()
def create_account():
    """Create new account for current user"""
    user_id = get_jwt_identity()
    data = request.get_json()
    
    if not data.get('account_id'):
        return jsonify({'error': 'account_id is required'}), 400
    
    try:
        account = db_manager.create_account(
            user_id=user_id, 
            acct_id_str=data['account_id'], 
            account_name=data.get('account_name', data['account_id'])
        )
        return jsonify({'account': account.to_dict()}), 201
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/accounts/<int:account_id>', methods=['GET'])
@jwt_required()
def get_account(account_id):
    """Get specific account details"""
    acc = validate_ownership(account_id)
    if not acc:
        return jsonify({'error': 'Unauthorized or account not found'}), 403
        
    return jsonify(acc.to_dict()), 200

# TRANSACTION ENDPOINTS ====================================================
@app.route('/api/accounts/<int:account_id>/transactions', methods=['GET'])
@jwt_required()
def get_transactions(account_id):
    """Get all transactions for an account"""
    if not validate_ownership(account_id):
        return jsonify({'error': 'Unauthorized'}), 403
    
    transactions = db_manager.get_account_transactions(account_id)
    
    return jsonify({
        'transactions': [t.to_dict() for t in transactions]
    }), 200

@app.route('/api/accounts/<int:account_id>/transactions', methods=['POST'])
@jwt_required()
def add_transaction(account_id):
    """Add a new transaction to an account"""
    if not validate_ownership(account_id):
        return jsonify({'error': 'Unauthorized'}), 403
    
    data = request.get_json()
    
    # Validate required fields
    required = ['date', 'vendor', 'category', 'amount']
    if not all(k in data for k in required):
        return jsonify({'error': f'Missing required fields: {required}'}), 400
    
    try:
        transaction = db_manager.add_transaction(
            account_id=account_id, 
            date_obj=datetime.fromisoformat(data['date']).date(),
            vendor=data['vendor'], 
            category=data['category'], 
            amount=float(data['amount']), 
            notes=data.get('notes', '')
        )
        
        acc = db_manager.get_account(account_id)
        
        return jsonify({
            'transaction': transaction.to_dict(),
            'new_balance': acc.balance
        }), 201
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400
    
@app.route('/api/transactions/<int:transaction_id>', methods=['PUT', 'PATCH'])
@jwt_required()
def update_transaction(transaction_id):
    """Update an existing transaction"""
    user_id = get_jwt_identity()
    
    transaction = TransactionModel.query.get(transaction_id)
    
    if not transaction:
        return jsonify({'error': 'Transaction not found'}), 404
    
    if transaction.account.user_id != user_id:
        return jsonify({'error': 'Unauthorized'}), 403
    
    data = request.get_json()
    
    # Build update kwargs
    update_fields = {}
    if 'date' in data:
        update_fields['date'] = datetime.fromisoformat(data['date']).date()
    if 'vendor' in data:
        update_fields['vendor'] = data['vendor']
    if 'category' in data:
        update_fields['category'] = data['category']
    if 'amount' in data:
        update_fields['amount'] = float(data['amount'])
    if 'notes' in data:
        update_fields['notes'] = data['notes']
    
    try:
        updated = db_manager.update_transaction(transaction_id, **update_fields)
        
        return jsonify({
            'transaction': updated.to_dict(),
            'new_balance': transaction.account.balance
        }), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400
    
@app.route('/api/transactions/<int:transaction_id>', methods=['DELETE'])
@jwt_required()
def delete_transaction(transaction_id):
    """Delete a transaction"""
    user_id = get_jwt_identity()
    
    transaction = TransactionModel.query.get(transaction_id)
    
    if not transaction:
        return jsonify({'error': 'Transaction not found'}), 404
    
    if transaction.account.user_id != user_id:
        return jsonify({'error': 'Unauthorized'}), 403
    
    success = db_manager.delete_transaction(transaction_id)
    
    if success:
        return jsonify({
            'message': 'Transaction deleted',
            'new_balance': db_manager.get_account(transaction.account_id).balance
        }), 200
        
    return jsonify({'error': 'Failed to delete'}), 400

# RECURRING TRANSACTION ENDPOINTS ==========================================
@app.route('/api/accounts/<int:account_id>/recurring', methods=['GET'])
@jwt_required()
def get_recurring(account_id):
    """Get all recurring transactions for an account"""
    if not validate_ownership(account_id):
        return jsonify({'error': 'Unauthorized'}), 403
    
    recurring = db_manager.get_account_recurring(account_id)
    
    return jsonify({
        'recurring': [r.to_dict() for r in recurring]
    }), 200

@app.route('/api/accounts/<int:account_id>/recurring', methods=['POST'])
@jwt_required()
def add_recurring(account_id):
    """Add a new recurring transaction template"""
    if not validate_ownership(account_id):
        return jsonify({'error': 'Unauthorized'}), 403
    
    data = request.get_json()
    
    required = ['start_date', 'vendor', 'category', 'amount', 'frequency']
    if not all(k in data for k in required):
        return jsonify({'error': f'Missing required fields: {required}'}), 400
    
    try:
        # Parse dates
        start_date = datetime.fromisoformat(data['start_date']).date()
        next_date = datetime.fromisoformat(data['next_date']).date() if 'next_date' in data else start_date
        
        recurring = db_manager.add_recurring(
            account_id=account_id,
            start_date=start_date,
            vendor=data['vendor'],
            category=data['category'],
            amount=float(data['amount']),
            next_date=next_date,
            frequency=int(data['frequency']),
            number=int(data.get('number', -1)),
            notes=data.get('notes', '')
        )
        
        return jsonify({'recurring': recurring.to_dict()}), 201
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/recurring/<int:recurring_id>', methods=['PUT', 'PATCH'])
@jwt_required()
def update_recurring_endpoint(recurring_id):
    """Update a recurring transaction (will clean up excess generated transactions)"""
    user_id = get_jwt_identity()
    
    recurring = RecurringModel.query.get(recurring_id)
    
    if not recurring:
        return jsonify({'error': 'Recurring transaction not found'}), 404
    
    if recurring.account.user_id != user_id:
        return jsonify({'error': 'Unauthorized'}), 403
    
    data = request.get_json()
    
    # Build update kwargs
    update_fields = {}
    if 'start_date' in data:
        update_fields['start_date'] = datetime.fromisoformat(data['start_date']).date()
    if 'vendor' in data:
        update_fields['vendor'] = data['vendor']
    if 'category' in data:
        update_fields['category'] = data['category']
    if 'amount' in data:
        update_fields['amount'] = float(data['amount'])
    if 'next_date' in data:
        update_fields['next_date'] = datetime.fromisoformat(data['next_date']).date()
    if 'frequency' in data:
        update_fields['frequency'] = int(data['frequency'])
    if 'number' in data:
        update_fields['number'] = int(data['number'])
    if 'notes' in data:
        update_fields['notes'] = data['notes']
    
    try:
        updated = db_manager.update_recurring(recurring_id, **update_fields)
        
        return jsonify({
            'recurring': updated.to_dict(),
            'message': 'Recurring transaction updated'
        }), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/recurring/<int:recurring_id>', methods=['DELETE'])
@jwt_required()
def delete_recurring_endpoint(recurring_id):
    """Delete a recurring transaction template"""
    user_id = get_jwt_identity()
    
    recurring = RecurringModel.query.get(recurring_id)
    
    if not recurring:
        return jsonify({'error': 'Recurring transaction not found'}), 404
    
    if recurring.account.user_id != user_id:
        return jsonify({'error': 'Unauthorized'}), 403
    
    # Check if user wants to delete generated transactions too
    delete_generated = request.args.get('delete_generated', 'false').lower() == 'true'
    
    success = db_manager.delete_recurring(recurring_id, delete_generated=delete_generated)
    
    if success:
        return jsonify({
            'message': 'Recurring transaction deleted',
            'deleted_generated': delete_generated
        }), 200
        
    return jsonify({'error': 'Failed to delete'}), 400

# ANALYTICS ================================================================
@app.route('/api/accounts/<int:account_id>/analytics', methods=['GET'])
@jwt_required()
def get_analytics(account_id):
    """Get comprehensive analytics for an account"""
    acc = validate_ownership(account_id)
    if not acc:
        return jsonify({'error': 'Unauthorized'}), 403
    
    transactions = db_manager.get_account_transactions(account_id)
    analytics_data = FinanceDataProcessor.generate_api_report(transactions)
    
    return jsonify(analytics_data), 200

# CSV IMPORT ================================================================
@app.route('/api/accounts/<int:account_id>/import-csv', methods=['POST'])
@jwt_required()
def import_csv(account_id):
    """Import transactions from CSV file"""
    if not validate_ownership(account_id):
        return jsonify({'error': 'Unauthorized'}), 403
    
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    try:
        # Load and process CSV
        df = FinanceDataProcessor.load_csv(file)
        
        count = 0
        for _, row in df.iterrows():
            db_manager.add_transaction(
                account_id=account_id, 
                date_obj=row['date'], 
                vendor=row['vendor'],  # Fixed: was 'store', now 'vendor'
                category=row['category'], 
                amount=row['amount'], 
                notes=row.get('notes', '')
            )
            count += 1
        
        # Recalculate balance to ensure accuracy
        new_balance = db_manager.recalculate_account_balance(account_id)
        
        return jsonify({
            'message': f'Successfully imported {count} transactions',
            'count': count,
            'new_balance': new_balance
        }), 200
        
    except Exception as e:
        return jsonify({'error': f'Import failed: {str(e)}'}), 400

# ERROR HANDLERS============================================================
@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(Exception)
def handle_exception(error):
    """Catch-all error handler for debugging"""
    import traceback
    return jsonify({
        'error': str(error),
        'traceback': traceback.format_exc() if app.debug else None
    }), 500

# DATABASE INITIALIZATION ==================================================
@app.before_request
def create_tables():
    """Create database tables on first request"""
    if not hasattr(app, 'tables_created'):
        with app.app_context():
            db.create_all()
            app.tables_created = True

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        print("Database tables created")
        print(f"Server running on http://localhost:5000")
    
    app.run(debug=True, port=5000, host='0.0.0.0')