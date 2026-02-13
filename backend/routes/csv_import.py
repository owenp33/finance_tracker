"""
csv_import.py - CSV import routes
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from models import DatabaseManager
from services import FinanceDataProcessor

csv_bp = Blueprint('csv', __name__)
db_manager = DatabaseManager()

def validate_ownership(account_id):
    """Ensure user owns the account"""
    user_id = get_jwt_identity()
    account = db_manager.get_account(account_id)
    
    if (not account) or (int(account.user_id) != int(user_id)):
        return None
    return account

@csv_bp.route('/accounts/<int:account_id>/import-csv', methods=['POST'])
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
                vendor=row['vendor'],
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