"""
csv_import.py - CSV import routes
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from services import DbService, AccountService, AnalyticsService
from middleware.ownership import owns_account

csv_bp = Blueprint('csv', __name__)
db_service = DbService()
account_service = AccountService()


@csv_bp.route('/accounts/<int:account_id>/import-csv', methods=['POST'])
@jwt_required()
@owns_account
def import_csv(account_id):
    """Import transactions from CSV file"""
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file provided'}), 400

    file = request.files['file']

    if file.filename == '':
        return jsonify({'success': False, 'error': 'No file selected'}), 400

    df = AnalyticsService.load_csv(file)

    imported = 0
    skipped = 0
    for _, row in df.iterrows():
        amount_cents = int(round(float(row['amount']) * 100))
        if amount_cents == 0 or db_service.transaction_exists(account_id, row['date'], row['vendor'], amount_cents):
            skipped += 1
            continue
        db_service.add_transaction(
            account_id=account_id,
            date_obj=row['date'],
            vendor=row['vendor'],
            category=row['category'],
            amount=row['amount'],
            notes=row.get('notes', '')
        )
        imported += 1

    new_balance = account_service.recalculate_account_balance(account_id)

    return jsonify({
        'success': True,
        'message': f'Imported {imported} transactions, skipped {skipped} duplicates',
        'count': imported,
        'skipped': skipped,
        'new_balance': new_balance
    }), 200