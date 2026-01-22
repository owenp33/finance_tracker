import os
import sys
from datetime import datetime, date, timedelta
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_jwt_extended import (
    JWTManager, create_access_token, jwt_required, get_jwt_identity
)

# Adding logic paths
sys.path.append('../data-preprocessing')

from models import DatabaseManager, TransactionModel # Added Model imports
from accounts import FinanceDataProcessor

app = Flask(__name__)
app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', 'dev-secret-key')
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(days=7)

CORS(app, resources={r"/api/*": {"origins": "http://localhost:3000"}})
jwt = JWTManager(app)
db = DatabaseManager()

# ==================== HELPERS ====================

def validate_ownership(account_id):
    """Utility to ensure the JWT user actually owns the account they are requesting"""
    user_id = get_jwt_identity()
    account = db.get_account(account_id)
    if not account or account.user_id != user_id:
        return None
    return account

def update_user_recurring(user_id):
    """Processes all recurring transactions for a user across all accounts"""
    accounts = db.get_user_accounts(user_id)
    total_gen = 0
    today = date.today()

    for acc in accounts:
        recurring_templates = db.get_account_recurring(acc.id)
        for rec in recurring_templates:
            # rec is a RecurringModel instance
            while rec.next_date <= today and rec.number != 0:
                db.add_transaction(
                    acc.id, rec.next_date, rec.vendor, rec.category, 
                    rec.amount, f"Auto-gen: {rec.notes}"
                )
                # Advance logic
                rec.next_date += timedelta(days=rec.frequency)
                if rec.number > 0: rec.number -= 1
                total_gen += 1
            
            db.update_recurring_after_generation(rec.id, rec.next_date, rec.number)
    return total_gen

# ==================== AUTH ENDPOINTS ====================

@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json()
    try:
        user = db.create_user(data['username'], data['email'], data['password'])
        return jsonify({
            'user': user.to_dict(),
            'access_token': create_access_token(identity=user.id)
        }), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    user = db.authenticate_user(data.get('username'), data.get('password'))
    
    if not user:
        return jsonify({'error': 'Invalid credentials'}), 401
    
    # Process recurring transactions immediately upon login
    generated = update_user_recurring(user.id)
    
    return jsonify({
        'user': user.to_dict(),
        'access_token': create_access_token(identity=user.id),
        'updates': {'transactions_generated': generated}
    }), 200

# ==================== ACCOUNT & TRANSACTION ENDPOINTS ====================

@app.route('/api/accounts', methods=['GET'])
@jwt_required()
def get_accounts():
    user_id = get_jwt_identity()
    accounts = db.get_user_accounts(user_id)
    return jsonify([acc.to_dict() for acc in accounts]), 200

@app.route('/api/accounts/<int:account_id>/transactions', methods=['GET'])
@jwt_required()
def get_transactions(account_id):
    if not validate_ownership(account_id):
        return jsonify({'error': 'Unauthorized'}), 403
    
    transactions = db.get_account_transactions(account_id)
    return jsonify([t.to_dict() for t in transactions]), 200

@app.route('/api/accounts/<int:account_id>/transactions', methods=['POST'])
@jwt_required()
def add_transaction(account_id):
    if not validate_ownership(account_id):
        return jsonify({'error': 'Unauthorized'}), 403
    
    data = request.get_json()
    t = db.add_transaction(
        account_id, 
        datetime.fromisoformat(data['date']).date(),
        data['vendor'], data['category'], float(data['amount']), data.get('notes', '')
    )
    return jsonify(t.to_dict()), 201

# ==================== ANALYTICS (REFACTORED) ====================

@app.route('/api/accounts/<int:account_id>/analytics', methods=['GET'])
@jwt_required()
def get_analytics(account_id):
    acc = validate_ownership(account_id)
    if not acc: return jsonify({'error': 'Unauthorized'}), 403
    
    # We fetch raw transactions
    transactions = db.get_account_transactions(account_id)
    
    # Instead of doing Pandas here, we pass the list to our Processor
    # This keeps the API layer "thin"
    analytics_data = FinanceDataProcessor.generate_api_report(transactions)
    
    return jsonify(analytics_data), 200

# ==================== CSV IMPORT ====================

@app.route('/api/accounts/<int:account_id>/import-csv', methods=['POST'])
@jwt_required()
def import_csv(account_id):
    if not validate_ownership(account_id): return jsonify({'error': 'Unauthorized'}), 403
    
    file = request.files.get('file')
    if not file: return jsonify({'error': 'No file'}), 400
    
    # Process using a temporary stream or file
    try:
        # Pass the file directly to your processor
        df = FinanceDataProcessor.load_csv(file) 
        
        for _, row in df.iterrows():
            db.add_transaction(
                account_id, row['date'], row['vendor'], 
                row['category'], row['amount'], row.get('notes', '')
            )
            
        new_balance = db.recalculate_account_balance(account_id)
        return jsonify({'message': 'Import successful', 'new_balance': new_balance}), 200
    except Exception as e:
        return jsonify({'error': f"Import failed: {str(e)}"}), 400

if __name__ == '__main__':
    app.run(debug=True, port=5000)