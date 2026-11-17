"""
goals.py - Goal routes (Phase F, F2)

Routes are intentionally thin: parse input, call a service, return a response.

Endpoints
---------
GET    /api/goals          The user's goals in order, each with its balance and status
POST   /api/goals          Add a goal at the end: {account_id, target, monthly?}
PATCH  /api/goals/<id>     Change its target and/or monthly amount (null: the app's suggestion)
DELETE /api/goals/<id>     Delete it; the goals after it move up
PUT    /api/goals/order    Reorder: {goal_ids: [every goal's id, in the new order]}
"""
from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from services import GoalService
from middleware.ownership import owns_goal
from middleware.request_body import json_body

goals_bp = Blueprint('goals', __name__)
goal_service = GoalService()


@goals_bp.route('', methods=['GET'])
@jwt_required()
def list_goals():
    """The user's goals in order, each with its account's balance and its status."""
    return jsonify({'success': True, 'goals': goal_service.list_goals(get_jwt_identity())}), 200


@goals_bp.route('', methods=['POST'])
@jwt_required()
def create_goal():
    """Add a goal at the end of the order."""
    user_id = get_jwt_identity()
    try:
        goal = goal_service.create_goal(user_id, json_body())
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    return jsonify({'success': True, 'goal': goal_service.goal_dict(user_id, goal.id)}), 201


@goals_bp.route('/order', methods=['PUT'])
@jwt_required()
def reorder_goals():
    """Put the goals in a new order."""
    user_id = get_jwt_identity()
    try:
        goal_service.reorder(user_id, json_body().get('goal_ids'))
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    return jsonify({'success': True, 'goals': goal_service.list_goals(user_id)}), 200


@goals_bp.route('/<int:goal_id>', methods=['PATCH'])
@jwt_required()
@owns_goal
def update_goal(goal_id):
    """Change a goal's target and/or monthly amount."""
    try:
        goal_service.update_goal(goal_id, json_body())
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    return jsonify({'success': True, 'goal': goal_service.goal_dict(get_jwt_identity(), goal_id)}), 200


@goals_bp.route('/<int:goal_id>', methods=['DELETE'])
@jwt_required()
@owns_goal
def delete_goal(goal_id):
    """Delete a goal."""
    goal_service.delete_goal(goal_id)
    return jsonify({'success': True}), 200
