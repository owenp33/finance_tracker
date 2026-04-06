"""
csv_import.py - CSV import routes
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from services import DbService, AccountService, AnalyticsService

csv_bp = Blueprint('csv', __name__)
db_service = DbService()
account_service = AccountService()


@csv_bp.route('/preview', methods=['POST'])
@jwt_required()
def preview_csv():
    """
    Return the unique account names found in a CSV file's 'account' column.
    Used by the frontend to show match status before committing an import.
    """
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file provided'}), 400

    file = request.files['file']
    df = AnalyticsService.load_csv(file)

    if 'account' not in df.columns:
        return jsonify({'success': True, 'account_names': []}), 200

    names = df['account'].dropna().astype(str).str.strip()
    names = names[names != ''].unique().tolist()

    return jsonify({'success': True, 'account_names': names}), 200


@csv_bp.route('/import', methods=['POST'])
@jwt_required()
def import_csv():
    """
    Import transactions from a CSV file.
    Routes each row to the correct account using the 'account' column when present.
    Falls back to the account_id form field for CSVs without an account column.
    """
    user_id = get_jwt_identity()

    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file provided'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'error': 'No file selected'}), 400

    fallback_account_id = request.form.get('account_id', type=int)

    df = AnalyticsService.load_csv(file)

    # Build a lookup map: lowercase name/id -> account db id, scoped to this user
    user_accounts = db_service.get_user_accounts(user_id)
    account_map = {}
    for a in user_accounts:
        account_map[a.acct_name.lower().strip()] = a.id
        account_map[a.acct_id_str.lower().strip()] = a.id

    has_account_col = 'account' in df.columns

    imported = 0
    skipped = 0
    unmatched = set()

    for _, row in df.iterrows():
        # Resolve which account this row belongs to
        if has_account_col:
            row_acct_name = str(row.get('account', '')).strip()
            target_id = account_map.get(row_acct_name.lower())
            if not target_id:
                unmatched.add(row_acct_name)
                skipped += 1
                continue
        else:
            target_id = fallback_account_id

        if not target_id:
            skipped += 1
            continue

        amount_cents = int(round(float(row['amount']) * 100))
        if amount_cents == 0 or db_service.transaction_exists(target_id, row['date'], row['vendor'], amount_cents):
            skipped += 1
            continue

        db_service.add_transaction(
            account_id=target_id,
            date_obj=row['date'],
            vendor=row['vendor'],
            category=row['category'],
            amount=row['amount'],
            notes=row.get('notes', '')
        )
        imported += 1

    # Recalculate balances for all affected accounts
    for a in user_accounts:
        account_service.recalculate_account_balance(a.id)

    msg = f'Imported {imported} transactions, skipped {skipped} duplicates/blanks'
    if unmatched:
        msg += f'. Unmatched accounts (not imported): {", ".join(unmatched)}'

    return jsonify({
        'success': True,
        'message': msg,
        'imported': imported,
        'skipped': skipped,
        'unmatched': list(unmatched),
    }), 200
