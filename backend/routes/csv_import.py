"""
csv_import.py - CSV import routes

Two-step stateless import flow:

  POST /csv/preview   Parse a CSV file and return rows as JSON with per-row
                      account resolution and duplicate detection. No DB writes.

  POST /csv/confirm   Accept the rows the user approved, write them to the DB.
                      Re-verifies duplicates and ownership server-side.
"""
from datetime import datetime
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from services import DbService, AccountService, AnalyticsService

csv_bp = Blueprint('csv', __name__)
db_service     = DbService()
account_service = AccountService()


@csv_bp.route('/preview', methods=['POST'])
@jwt_required()
def preview_csv():
    """
    Parse a CSV file and return every row as JSON with:
      - account_id / account_name resolved from the 'account' column (or
        the fallback account_id form field for single-account CSVs)
      - duplicate: true when an identical row already exists in the DB
    No data is written.
    """
    user_id = get_jwt_identity()

    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file provided'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'error': 'No file selected'}), 400

    try:
        df = AnalyticsService.load_csv(file)
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400

    # Build a name/id → account lookup scoped to this user
    user_accounts   = db_service.get_user_accounts(user_id)
    account_map     = {}
    for a in user_accounts:
        account_map[a.acct_name.lower().strip()]  = a
        account_map[a.acct_id_str.lower().strip()] = a

    has_account_col     = 'account' in df.columns
    fallback_account_id = request.form.get('account_id', type=int)
    fallback_account    = next((a for a in user_accounts if a.id == fallback_account_id), None)

    rows            = []
    unmatched_names = set()

    for _, row in df.iterrows():
        # Resolve which account this row belongs to
        if has_account_col:
            raw_name  = str(row.get('account', '')).strip()
            account   = account_map.get(raw_name.lower())
            if account:
                account_id   = account.id
                account_name = account.acct_name
            else:
                unmatched_names.add(raw_name)
                account_id   = None
                account_name = raw_name
        else:
            account_id   = fallback_account_id
            account_name = fallback_account.acct_name if fallback_account else None

        amount       = round(float(row['amount']), 2)
        amount_cents = int(round(amount * 100))

        zero_amount  = amount_cents == 0
        is_duplicate = (
            not zero_amount
            and account_id is not None
            and db_service.transaction_exists(account_id, row['date'], row['vendor'], amount_cents)
        )

        category    = str(row['category'])
        is_transfer = category.strip().lower() in ('transfer', 'payment')

        rows.append({
            'date':         row['date'].isoformat(),
            'vendor':       str(row['vendor']),
            'category':     category,
            'amount':       amount,
            'notes':        str(row.get('notes', '') or ''),
            'account_id':   account_id,
            'account_name': account_name,
            'duplicate':    is_duplicate,
            'zero_amount':  zero_amount,
            'is_transfer':  is_transfer,
        })

    importable = sum(
        1 for r in rows
        if not r['duplicate']
        and not r['zero_amount']
        and r['account_id'] is not None
    )

    return jsonify({
        'success': True,
        'rows':    rows,
        'summary': {
            'total':        len(rows),
            'importable':   importable,
            'duplicates':   sum(r['duplicate']   for r in rows),
            'unmatched':    sum(r['account_id'] is None for r in rows),
            'zero_amount':  sum(r['zero_amount'] for r in rows),
        },
        'unmatched_account_names': list(unmatched_names),
    }), 200


@csv_bp.route('/confirm', methods=['POST'])
@jwt_required()
def confirm_import():
    """
    Commit a list of approved rows to the database.

    Expects JSON body: { "transactions": [ { account_id, date, vendor,
                                             category, amount, notes }, ... ] }

    Ownership and duplicate checks are re-run server-side — the client's
    preview state is not trusted.
    """
    user_id = get_jwt_identity()
    data    = request.get_json()

    if not data or not isinstance(data.get('transactions'), list):
        return jsonify({'success': False, 'error': "'transactions' array required"}), 400

    rows = data['transactions']
    if not rows:
        return jsonify({'success': False, 'error': 'No transactions provided'}), 400

    # Build the set of account IDs this user is allowed to write to
    user_account_ids = {a.id for a in db_service.get_user_accounts(user_id)}

    imported                = 0
    skipped                 = 0
    affected_accounts       = set()
    newly_created_transfers = []

    for row in rows:
        account_id = row.get('account_id')

        # Ownership check
        if not account_id or account_id not in user_account_ids:
            skipped += 1
            continue

        try:
            date_obj    = datetime.fromisoformat(row['date']).date()
            amount      = float(row['amount'])
            vendor      = str(row['vendor'])
            category    = str(row['category'])
            is_transfer = bool(row.get('is_transfer', False))
        except (KeyError, ValueError, TypeError):
            skipped += 1
            continue

        amount_cents = int(round(amount * 100))

        # Skip blank amounts and duplicates (re-checked server-side)
        if amount_cents == 0 or db_service.transaction_exists(account_id, date_obj, vendor, amount_cents):
            skipped += 1
            continue

        tx = account_service.add_transaction(
            account_id=account_id,
            date_obj=date_obj,
            vendor=vendor,
            category=category,
            amount=amount,
            notes=str(row.get('notes', '') or ''),
            is_transfer=is_transfer,
        )
        affected_accounts.add(account_id)
        imported += 1

        if is_transfer:
            newly_created_transfers.append(tx)

    for aid in affected_accounts:
        account_service.recalculate_account_balance(aid)

    # Link transfer pairs — covers both cross-batch matches and existing unlinked transfers
    linked = 0
    for tx in newly_created_transfers:
        if tx.transfer_peer_id is None:
            peer = db_service.find_transfer_peer(
                user_id, tx.amount_cents, tx.date, tx.account_id, exclude_id=tx.id
            )
            if peer:
                account_service.link_transfer(tx.id, peer.id)
                linked += 1

    return jsonify({
        'success':  True,
        'message':  f'Imported {imported} transactions, skipped {skipped} duplicates/invalid',
        'imported': imported,
        'skipped':  skipped,
        'linked':   linked,
    }), 200
