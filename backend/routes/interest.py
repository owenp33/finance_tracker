"""
interest.py - Interest hit routes (Phase F): interest is a record of its own, not a transaction, and
waits for the user's approval before it moves a balance

Routes are intentionally thin: parse input, call a service, return a response.

Endpoints
---------
GET    /api/interest               The user's interest hits, approved or waiting, newest first
PATCH  /api/interest/<id>          Change a waiting hit's amount to the bank's figure: {amount} (dollars, 0 or more)
POST   /api/interest/<id>/approve  Approve a waiting hit: it moves its account's balance
DELETE /api/interest/<id>          Delete a waiting hit (its period stays done)
"""
from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from services import DbService
from services.interest_service import InterestService
from middleware.ownership import owns_interest_hit
from middleware.request_body import json_body

interest_bp = Blueprint('interest', __name__)
db_service = DbService()
interest_service = InterestService()


@interest_bp.route('', methods=['GET'])
@jwt_required()
def list_interest():
    """The user's interest hits, newest first."""
    hits = db_service.get_user_interest_hits(get_jwt_identity())
    return jsonify({'success': True, 'interest': [hit.to_dict() for hit in hits]}), 200


@interest_bp.route('/<int:hit_id>', methods=['PATCH'])
@jwt_required()
@owns_interest_hit
def update_interest(hit_id):
    """Change a waiting hit's amount; returns the hit and its account."""
    try:
        hit = interest_service.update_hit(hit_id, json_body().get('amount'))
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    return jsonify({'success': True, 'interest': hit.to_dict(), 'account': hit.account.to_dict()}), 200


@interest_bp.route('/<int:hit_id>/approve', methods=['POST'])
@jwt_required()
@owns_interest_hit
def approve_interest(hit_id):
    """Approve a waiting hit; returns it and its account, whose balance it moved."""
    try:
        hit = interest_service.approve_hit(hit_id)
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    return jsonify({'success': True, 'interest': hit.to_dict(), 'account': hit.account.to_dict()}), 200


@interest_bp.route('/<int:hit_id>', methods=['DELETE'])
@jwt_required()
@owns_interest_hit
def delete_interest(hit_id):
    """Delete a waiting hit."""
    try:
        interest_service.delete_hit(hit_id)
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    return jsonify({'success': True}), 200
