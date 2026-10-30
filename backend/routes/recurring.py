"""
recurring.py - Recurring transaction routes
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from datetime import datetime
from services import DbService, RecurringService, BudgetFlagService
from middleware.ownership import owns_recurring, owns_transaction
from middleware.request_body import json_body

recurring_bp = Blueprint('recurring', __name__)
db_service        = DbService()
recurring_service = RecurringService()
budget_flags      = BudgetFlagService()


@recurring_bp.route('/<int:recurring_id>', methods=['GET'])
@jwt_required()
@owns_recurring
def get_recurring(recurring_id):
    """Return a single recurring transaction template."""
    rec = db_service.get_recurring(recurring_id)
    return jsonify({'success': True, 'recurring': recurring_service.template_dict(rec)}), 200


@recurring_bp.route('/<int:recurring_id>', methods=['PUT', 'PATCH'])
@jwt_required()
@owns_recurring
def update_recurring(recurring_id):
    """Update a recurring transaction"""
    data = request.get_json()

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
    if 'frequency_unit' in data:
        update_fields['frequency_unit'] = data['frequency_unit']
    if 'number' in data:
        update_fields['number'] = int(data['number'])
    if 'notes' in data:
        update_fields['notes'] = data['notes']

    try:
        updated = recurring_service.update_recurring(recurring_id, **update_fields)
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400

    return jsonify({
        'success': True,
        'recurring': recurring_service.template_dict(updated),
        'message': 'Recurring transaction updated'
    }), 200


@recurring_bp.route('/<int:recurring_id>', methods=['DELETE'])
@jwt_required()
@owns_recurring
def delete_recurring(recurring_id):
    """Delete a recurring transaction template"""
    delete_generated = request.args.get('delete_generated', 'false').lower() == 'true'

    recurring_service.delete_recurring(recurring_id, delete_generated=delete_generated)

    return jsonify({
        'success': True,
        'message': 'Recurring transaction deleted',
        'deleted_generated': delete_generated
    }), 200


# SERIES MEMBERSHIP =============================================================

def _suggestion_dict(suggestion, transaction_dicts):
    return {
        'date':       suggestion['date'].isoformat(),
        'kind':       suggestion['kind'],
        'linked':     [transaction_dicts[t.id] for t in suggestion['linked']],
        'candidates': [transaction_dicts[t.id] for t in suggestion['candidates']],
    }


@recurring_bp.route('/<int:recurring_id>/suggestions', methods=['GET'])
@jwt_required()
@owns_recurring
def get_suggestions(recurring_id):
    """Transactions that may belong to this series (missing, duplicate, or history), for the user to confirm."""
    suggestions = recurring_service.suggest_matches(recurring_id)
    # Budget flags for every row at once, rather than per suggestion
    rows = [t for s in suggestions for t in s['linked'] + s['candidates']]
    transaction_dicts = {d['id']: d for d in budget_flags.transaction_dicts(get_jwt_identity(), rows)}
    return jsonify({'success': True, 'suggestions': [_suggestion_dict(s, transaction_dicts) for s in suggestions]}), 200


@recurring_bp.route('/<int:recurring_id>/transactions/<int:transaction_id>', methods=['POST'])
@jwt_required()
@owns_recurring
@owns_transaction
def link_transaction(recurring_id, transaction_id):
    """Make an existing transaction an occurrence of this series."""
    try:
        rec = recurring_service.link_transaction(recurring_id, transaction_id)
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    return jsonify({'success': True, 'recurring': recurring_service.template_dict(rec)}), 200


@recurring_bp.route('/<int:recurring_id>/transactions/<int:transaction_id>', methods=['DELETE'])
@jwt_required()
@owns_recurring
@owns_transaction
def unlink_transaction(recurring_id, transaction_id):
    """Take a transaction out of this series, keeping the transaction."""
    try:
        rec = recurring_service.unlink_transaction(recurring_id, transaction_id)
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    return jsonify({'success': True, 'recurring': recurring_service.template_dict(rec)}), 200


@recurring_bp.route('/<int:recurring_id>/dismissals/<int:transaction_id>', methods=['POST'])
@jwt_required()
@owns_recurring
@owns_transaction
def dismiss_suggestion(recurring_id, transaction_id):
    """Mark a suggested transaction as not part of this series, so it isn't suggested again."""
    try:
        rec = recurring_service.dismiss_suggestion(recurring_id, transaction_id)
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    return jsonify({'success': True, 'recurring': recurring_service.template_dict(rec)}), 200


@recurring_bp.route('/<int:recurring_id>/dismissals/<int:transaction_id>', methods=['DELETE'])
@jwt_required()
@owns_recurring
@owns_transaction
def undo_dismissal(recurring_id, transaction_id):
    """Let a dismissed transaction be suggested for this series again."""
    rec = recurring_service.undo_dismissal(recurring_id, transaction_id)
    return jsonify({'success': True, 'recurring': recurring_service.template_dict(rec)}), 200


# FINDING SERIES ================================================================

def _detected_dict(series, transaction_dicts):
    return {
        'account_id':     series.account_id,
        'vendor':         series.vendor,
        'category':       series.category,
        'amount':         series.amount_cents / 100,
        'frequency':      series.frequency,
        'frequency_unit': series.frequency_unit,
        'ongoing':        series.ongoing,
        'next_date':      series.next_date.isoformat() if series.next_date else None,
        'transactions':   [transaction_dicts[t.id] for t in series.transactions],
    }


@recurring_bp.route('/detected', methods=['GET'])
@jwt_required()
def detected_series():
    """Recurring series found among the user's transactions that aren't in a series yet, for the user to confirm."""
    user_id = get_jwt_identity()
    series = recurring_service.detect_series(user_id)
    rows = [t for s in series for t in s.transactions]
    transaction_dicts = {d['id']: d for d in budget_flags.transaction_dicts(user_id, rows)}
    return jsonify({'success': True, 'series': [_detected_dict(s, transaction_dicts) for s in series]}), 200


BAD_TRANSACTION_IDS = "'transaction_ids' must be a list of transaction ids."

DEFAULT_PROJECTION_DAYS = 60
MAX_PROJECTION_DAYS = 366


@recurring_bp.route('/projection', methods=['GET'])
@jwt_required()
def projection():
    """
    The user's recurring occurrences still to come, from today through ?days= days ahead
    (default DEFAULT_PROJECTION_DAYS, at most MAX_PROJECTION_DAYS), by date.
    """
    try:
        days = int(request.args.get('days', DEFAULT_PROJECTION_DAYS))
    except ValueError:
        days = 0
    if not 1 <= days <= MAX_PROJECTION_DAYS:
        return jsonify({'success': False,
                        'error': f"'days' must be a whole number from 1 to {MAX_PROJECTION_DAYS}."}), 400

    occurrences = recurring_service.projected_occurrences(get_jwt_identity(), days)
    return jsonify({'success': True, 'occurrences': [
        {
            'recurring_id': rec.id,
            'account_id':   rec.account_id,
            'date':         day.isoformat(),
            'vendor':       rec.vendor,
            'category':     rec.category,
            'amount':       rec.amount,
        }
        for rec, day in occurrences
    ]}), 200


def _transaction_ids():
    """The request body's non-empty list of transaction ids (whole numbers), or None when it isn't one."""
    ids = json_body().get('transaction_ids')
    if not isinstance(ids, list) or not ids:
        return None
    if any(isinstance(i, bool) or not isinstance(i, int) for i in ids):
        return None
    return ids


@recurring_bp.route('/detected', methods=['POST'])
@jwt_required()
def add_detected_series():
    """
    Make a detected series a template, linking its payments. Body: {transaction_ids}, exactly the
    series' payments as GET /detected listed them; a series that has changed since is a 400.
    """
    ids = _transaction_ids()
    if ids is None:
        return jsonify({'success': False, 'error': BAD_TRANSACTION_IDS}), 400
    try:
        rec = recurring_service.add_detected_series(get_jwt_identity(), ids)
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    return jsonify({'success': True, 'recurring': recurring_service.template_dict(rec)}), 201


@recurring_bp.route('/detected/dismissals', methods=['POST'])
@jwt_required()
def dismiss_detected_series():
    """Mark a detected series "Not recurring", so finding series leaves it out from then on. Body as for POST /detected."""
    ids = _transaction_ids()
    if ids is None:
        return jsonify({'success': False, 'error': BAD_TRANSACTION_IDS}), 400
    try:
        recurring_service.dismiss_detected_series(get_jwt_identity(), ids)
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    return jsonify({'success': True}), 200
