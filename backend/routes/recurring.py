"""
recurring.py - Recurring transaction routes
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from datetime import datetime
from services import DbService, AccountService
from middleware.ownership import owns_recurring

recurring_bp = Blueprint('recurring', __name__)
db_service      = DbService()
account_service = AccountService()


@recurring_bp.route('/<int:recurring_id>', methods=['GET'])
@jwt_required()
@owns_recurring
def get_recurring(recurring_id):
    """Return a single recurring transaction template."""
    rec = db_service.get_recurring(recurring_id)
    return jsonify({'success': True, 'recurring': rec.to_dict()}), 200


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
    if 'number' in data:
        update_fields['number'] = int(data['number'])
    if 'notes' in data:
        update_fields['notes'] = data['notes']

    updated = account_service.update_recurring(recurring_id, **update_fields)

    return jsonify({
        'success': True,
        'recurring': updated.to_dict(),
        'message': 'Recurring transaction updated'
    }), 200


@recurring_bp.route('/<int:recurring_id>', methods=['DELETE'])
@jwt_required()
@owns_recurring
def delete_recurring(recurring_id):
    """Delete a recurring transaction template"""
    delete_generated = request.args.get('delete_generated', 'false').lower() == 'true'

    account_service.delete_recurring(recurring_id, delete_generated=delete_generated)

    return jsonify({
        'success': True,
        'message': 'Recurring transaction deleted',
        'deleted_generated': delete_generated
    }), 200