"""
imports.py - File import routes (CSV, XLSX, XLS)

Two-step stateless import flow (the logic lives in ImportService):

  POST /import/preview   Parse an uploaded file and return rows as JSON with
                         per-row account resolution, duplicate detection and
                         recurring matches. No DB writes.

  POST /import/confirm   Accept the rows the user approved, write them to the DB.
                         Re-verifies duplicates and ownership server-side.
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from services import ImportService
from middleware.request_body import json_body

import_bp = Blueprint('import', __name__)
import_service = ImportService()


@import_bp.route('/preview', methods=['POST'])
@jwt_required()
def preview_csv():
    """
    Parse the uploaded 'file' and return its rows without writing anything.
    Optional form fields choose what happens to rows whose account isn't found:
    'unmatched' = create (default) | account | skip, and 'target_account_id' for 'account'.
    """
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file provided'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'error': 'No file selected'}), 400

    try:
        result = import_service.preview(
            get_jwt_identity(),
            file,
            unmatched=request.form.get('unmatched', 'create'),
            target_account_id=request.form.get('target_account_id', type=int),
        )
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400

    return jsonify({'success': True, **result}), 200


@import_bp.route('/confirm', methods=['POST'])
@jwt_required()
def confirm_import():
    """
    Commit a list of approved rows to the database.

    Expects JSON body: { "transactions": [ { account_id, account_name, new_account, date,
                                             vendor, category, amount, notes, is_transfer,
                                             replaces_transaction_id (optional) }, ... ] }

    Ownership, duplicate and recurring-replacement checks are re-run server-side — the
    client's preview state is not trusted. Rows marked new_account create their account;
    rows with replaces_transaction_id update that recurring series transaction instead.
    """
    rows = json_body().get('transactions')
    if not isinstance(rows, list):
        return jsonify({'success': False, 'error': "'transactions' array required"}), 400
    if not rows:
        return jsonify({'success': False, 'error': 'No transactions provided'}), 400

    try:
        result = import_service.confirm(get_jwt_identity(), rows)
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400

    message = f"Imported {result['imported']} transactions"
    replaced = result['replaced']
    if replaced:
        message += f", replaced {replaced} recurring transaction{'s' if replaced != 1 else ''}"
    message += f", skipped {result['skipped']} duplicates/invalid"
    created = len(result['created_accounts'])
    if created:
        message += f", created {created} new account{'s' if created != 1 else ''}"

    return jsonify({'success': True, 'message': message, **result}), 200
