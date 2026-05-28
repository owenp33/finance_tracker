"""
accounts.py - Account management routes
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from services import DbService, AccountService
from middleware.ownership import owns_account
from datetime import datetime, date, timedelta


accounts_bp = Blueprint('accounts', __name__)
db_service = DbService()
account_service = AccountService()


@accounts_bp.route('', methods=['GET'])
@jwt_required()
def get_accounts():
    """Get all bank accounts for current user"""
    user_id = get_jwt_identity()
    accounts = db_service.get_user_accounts(user_id)

    return jsonify({
        'success': True,
        'accounts': [acc.to_dict() for acc in accounts]
    }), 200


@accounts_bp.route('', methods=['POST'])
@jwt_required()
def create_account():
    """Create new account for current user"""
    user_id = get_jwt_identity()
    data = request.get_json()

    if not data.get('account_id'):
        return jsonify({'success': False, 'error': 'account_id is required'}), 400

    account = db_service.create_account(
        user_id=user_id,
        acct_id_str=data['account_id'],
        account_name=data.get('account_name', data['account_id'])
    )
    return jsonify({'success': True, 'account': account.to_dict()}), 201


@accounts_bp.route('/all-transactions', methods=['GET'])
@jwt_required()
def get_all_transactions():
    """Get all transactions across all accounts for current user"""
    user_id = get_jwt_identity()
    transactions = db_service.get_all_user_transactions(user_id)
    return jsonify({
        'success': True,
        'transactions': [t.to_dict() for t in transactions]
    }), 200


@accounts_bp.route('/<int:account_id>', methods=['GET'])
@jwt_required()
@owns_account
def get_account(account_id):
    """Get specific account details"""
    acc = db_service.get_account(account_id)
    return jsonify({'success': True, 'account': acc.to_dict()}), 200


@accounts_bp.route('/<int:account_id>', methods=['DELETE'])
@jwt_required()
@owns_account
def delete_account(account_id):
    """Delete account and all associated transactions and recurring items."""
    success, error = account_service.delete_account(account_id)
    if not success:
        return jsonify({'success': False, 'error': error}), 404
    return jsonify({'success': True}), 200


@accounts_bp.route('/<int:account_id>', methods=['PATCH'])
@jwt_required()
@owns_account
def update_account(account_id):
    """Update account name or id string."""
    data = request.get_json()
    acc, error = account_service.update_account(account_id, data)
    if error:
        return jsonify({'success': False, 'error': error}), 404
    return jsonify({'success': True, 'account': acc.to_dict()}), 200


@accounts_bp.route('/<int:account_id>/transactions', methods=['GET'])
@jwt_required()
@owns_account
def get_transactions(account_id):
    """
    Get transactions for an account with optional filters.

    Query params:
      start_date  YYYY-MM-DD  inclusive lower bound on date
      end_date    YYYY-MM-DD  inclusive upper bound on date
      category    str         exact category match
      over_budget true|false  return only flagged / un-flagged rows
      limit       int         max rows to return
      offset      int         rows to skip (for pagination)
    """
    args = request.args

    start_date  = None
    end_date    = None
    over_budget = None

    if args.get('start_date'):
        start_date = datetime.fromisoformat(args['start_date']).date()
    if args.get('end_date'):
        end_date = datetime.fromisoformat(args['end_date']).date()
    if args.get('over_budget') is not None:
        over_budget = args['over_budget'].lower() == 'true'

    transactions = db_service.get_account_transactions(
        account_id,
        start_date  = start_date,
        end_date    = end_date,
        category    = args.get('category'),
        over_budget = over_budget,
        limit       = args.get('limit',  type=int),
        offset      = args.get('offset', type=int),
    )

    return jsonify({
        'success': True,
        'transactions': [t.to_dict() for t in transactions]
    }), 200


@accounts_bp.route('/<int:account_id>/transactions', methods=['POST'])
@jwt_required()
@owns_account
def add_transaction(account_id):
    """Add a new transaction to an account"""
    data = request.get_json()

    required = ['date', 'vendor', 'category', 'amount']
    if not all(k in data for k in required):
        return jsonify({'success': False, 'error': f'Missing required fields: {required}'}), 400

    transaction = account_service.add_transaction(
        account_id=account_id,
        date_obj=datetime.fromisoformat(data['date']).date(),
        vendor=data['vendor'],
        category=data['category'],
        amount=float(data['amount']),
        notes=data.get('notes', ''),
        is_transfer=data.get('is_transfer', False),
    )

    acc = db_service.get_account(account_id)

    return jsonify({
        'success': True,
        'transaction': transaction.to_dict(),
        'new_balance': acc.balance
    }), 201


@accounts_bp.route('/<int:account_id>/upcoming', methods=['GET'])
@jwt_required()
@owns_account
def get_upcoming(account_id):
    """
    Return recurring items whose next occurrence falls within the next N days.

    Query params:
      days  int  look-ahead window in days (default 30)

    Only returns active recurring items (number == -1, or idx hasn't exceeded number).
    Results are sorted by next_date ascending.
    """
    days    = request.args.get('days', default=30, type=int)
    cutoff  = date.today() + timedelta(days=days)

    recurring = db_service.get_account_recurring(account_id)
    upcoming  = [
        r for r in recurring
        if r.next_date <= cutoff
        and (r.number == -1 or r.idx <= r.number)
    ]
    upcoming.sort(key=lambda r: r.next_date)

    return jsonify({'success': True, 'upcoming': [r.to_dict() for r in upcoming]}), 200


@accounts_bp.route('/<int:account_id>/recurring', methods=['GET'])
@jwt_required()
@owns_account
def get_recurring(account_id):
    """Get all recurring transactions for an account"""
    recurring = db_service.get_account_recurring(account_id)

    return jsonify({
        'success': True,
        'recurring': [r.to_dict() for r in recurring]
    }), 200


@accounts_bp.route('/<int:account_id>/recurring', methods=['POST'])
@jwt_required()
@owns_account
def add_recurring(account_id):
    """Add a new recurring transaction template"""
    data = request.get_json()

    required = ['start_date', 'vendor', 'category', 'amount', 'frequency']
    if not all(k in data for k in required):
        return jsonify({'success': False, 'error': f'Missing required fields: {required}'}), 400

    start_date = datetime.fromisoformat(data['start_date']).date()
    next_date = datetime.fromisoformat(data['next_date']).date() if 'next_date' in data else start_date

    recurring = account_service.add_recurring(
        account_id=account_id,
        start_date=start_date,
        vendor=data['vendor'],
        category=data['category'],
        amount=float(data['amount']),
        next_date=next_date,
        frequency=int(data['frequency']),
        number=int(data.get('number', -1)),
        notes=data.get('notes', '')
    )

    # Immediately generate any transactions that are already due
    account_service.process_due_recurring(account_id)

    return jsonify({'success': True, 'recurring': recurring.to_dict()}), 201