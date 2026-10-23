"""
imports.py - File import routes (CSV, XLSX, XLS)

Two-step stateless import flow (the logic lives in ImportService):

  POST /import/preview   Parse an uploaded file and return rows as JSON with
                         per-row account resolution and duplicate detection.
                         No DB writes.

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
    Optional form field 'account_id' assigns every row to that account when the
    file has no 'account' column.
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
            fallback_account_id=request.form.get('account_id', type=int),
        )
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400

    return jsonify({'success': True, **result}), 200


@import_bp.route('/confirm', methods=['POST'])
@jwt_required()
def confirm_import():
    """
    Commit a list of approved rows to the database.

    Expects JSON body: { "transactions": [ { account_id, date, vendor,
                                             category, amount, notes, is_transfer }, ... ] }

    Ownership and duplicate checks are re-run server-side — the client's
    preview state is not trusted.
    """
    rows = json_body().get('transactions')
    if not isinstance(rows, list):
        return jsonify({'success': False, 'error': "'transactions' array required"}), 400
    if not rows:
        return jsonify({'success': False, 'error': 'No transactions provided'}), 400

    result = import_service.confirm(get_jwt_identity(), rows)

    return jsonify({
        'success': True,
        'message': f"Imported {result['imported']} transactions, skipped {result['skipped']} duplicates/invalid",
        **result,
    }), 200
