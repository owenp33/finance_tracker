"""
budgets.py - Budget allocation routes

Routes are intentionally thin: parse input, call a service, return a response.
No ORM queries or business logic should live here.

Endpoints
---------
GET    /api/budgets               List allocations (optionally filtered by ?period=YYYY-MM)
POST   /api/budgets               Create a new allocation
GET    /api/budgets/progress      Computed spent-vs-allocated for a period
PATCH  /api/budgets/<id>          Update amount, rollover flag, or carried_over
DELETE /api/budgets/<id>          Remove an allocation
"""
from datetime import date
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from services import DbService, BudgetService
from middleware.ownership import owns_budget

budgets_bp = Blueprint('budgets', __name__)
db_service     = DbService()
budget_service = BudgetService()


@budgets_bp.route('', methods=['GET'])
@jwt_required()
def get_budgets():
    """List budget allocations, optionally filtered to a single period."""
    user_id = get_jwt_identity()
    period  = request.args.get('period')           # e.g. "2024-04"
    budgets = db_service.get_user_budgets(user_id, period=period)
    return jsonify({
        'success': True,
        'budgets': [b.to_dict() for b in budgets],
    }), 200


# NOTE: /progress must be registered before /<int:budget_id> so Flask does not
# try to cast the string "progress" as an integer.
@budgets_bp.route('/progress', methods=['GET'])
@jwt_required()
def get_budget_progress():
    """
    Return spent-vs-allocated for each category in a period.
    Defaults to the current calendar month when ?period is omitted.
    """
    user_id = get_jwt_identity()
    period  = request.args.get('period') or date.today().strftime('%Y-%m')
    progress = budget_service.get_budget_progress(user_id, period)
    return jsonify({
        'success':  True,
        'period':   period,
        'progress': progress,
    }), 200


@budgets_bp.route('', methods=['POST'])
@jwt_required()
def create_budget():
    """Create a new budget allocation for a category/period."""
    user_id = get_jwt_identity()
    data    = request.get_json()

    required = ['category', 'period', 'amount']
    if not all(k in data for k in required):
        return jsonify({'success': False, 'error': f'Missing required fields: {required}'}), 400

    # Guard against duplicates before hitting the DB constraint
    existing = db_service.get_user_budgets(user_id, period=data['period'])
    if any(b.category == data['category'] for b in existing):
        return jsonify({
            'success': False,
            'error': f"A budget for '{data['category']}' in {data['period']} already exists.",
        }), 409

    budget = db_service.create_budget(
        user_id     = user_id,
        category    = data['category'],
        period      = data['period'],
        amount      = float(data['amount']),
        rollover    = bool(data.get('rollover', False)),
        carried_over= float(data.get('carried_over', 0.0)),
    )
    return jsonify({'success': True, 'budget': budget.to_dict()}), 201


@budgets_bp.route('/<int:budget_id>', methods=['PATCH'])
@jwt_required()
@owns_budget
def update_budget(budget_id):
    """Update amount, rollover flag, or carried_over on an allocation."""
    data   = request.get_json()
    budget = db_service.get_budget(budget_id)

    if 'amount' in data:
        budget.amount = float(data['amount'])
    if 'rollover' in data:
        budget.rollover = bool(data['rollover'])
    if 'carried_over' in data:
        budget.carried_over = float(data['carried_over'])
    if 'category' in data:
        budget.category = data['category']

    from extensions import db
    db.session.commit()
    return jsonify({'success': True, 'budget': budget.to_dict()}), 200


@budgets_bp.route('/<int:budget_id>', methods=['DELETE'])
@jwt_required()
@owns_budget
def delete_budget(budget_id):
    """Remove a budget allocation."""
    db_service.delete_budget(budget_id)
    return jsonify({'success': True, 'message': 'Budget deleted'}), 200
