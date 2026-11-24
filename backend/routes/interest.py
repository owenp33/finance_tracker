"""
interest.py - Interest hit routes (Phase F): interest is a record of its own, not a transaction

Routes are intentionally thin: parse input, call a service, return a response.

Endpoints
---------
GET    /api/interest        The user's interest hits, newest first
PATCH  /api/interest/<id>   Change a hit's amount to the bank's figure: {amount} (dollars, 0 or more)
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
    """Change a hit's amount; returns the hit and its account, whose balance moved with it."""
    try:
        hit = interest_service.update_hit(hit_id, json_body().get('amount'))
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    return jsonify({'success': True, 'interest': hit.to_dict(), 'account': hit.account.to_dict()}), 200
