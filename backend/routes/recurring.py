"""
recurring.py - Recurring transaction routes
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from datetime import datetime
from models import RecurringModel
from services import AccountService

recurring_bp = Blueprint('recurring', __name__)
account_service = AccountService()

@recurring_bp.route('/<int:recurring_id>', methods=['PUT', 'PATCH'])
@jwt_required()
def update_recurring(recurring_id):
    """Update a recurring transaction"""
    user_id = get_jwt_identity()
    recurring = RecurringModel.query.get(recurring_id)

    if not recurring:
        return jsonify({'success': False, 'error': 'Recurring transaction not found'}), 404

    if int(recurring.account.user_id) != int(user_id):
        return jsonify({'success': False, 'error': 'Unauthorized'}), 403

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

    try:
        updated = account_service.update_recurring(recurring_id, **update_fields)

        return jsonify({
            'success': True,
            'recurring': updated.to_dict(),
            'message': 'Recurring transaction updated'
        }), 200

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400


@recurring_bp.route('/<int:recurring_id>', methods=['DELETE'])
@jwt_required()
def delete_recurring(recurring_id):
    """Delete a recurring transaction template"""
    user_id = get_jwt_identity()
    recurring = RecurringModel.query.get(recurring_id)

    if not recurring:
        return jsonify({'success': False, 'error': 'Recurring transaction not found'}), 404

    if int(recurring.account.user_id) != int(user_id):
        return jsonify({'success': False, 'error': 'Unauthorized'}), 403

    delete_generated = request.args.get('delete_generated', 'false').lower() == 'true'
    success = account_service.delete_recurring(recurring_id, delete_generated=delete_generated)

    if success:
        return jsonify({
            'success': True,
            'message': 'Recurring transaction deleted',
            'deleted_generated': delete_generated
        }), 200

    return jsonify({'success': False, 'error': 'Failed to delete'}), 400