"""
balances.py - Balances over time (Phase V, V4): each account's end-of-day balance per date

Takes the exports' filters (account_ids, start_date, end_date); a bad filter or an account that
isn't the user's is a 400.
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from services.balance_service import BalanceService
from services.reports import parse_export_filters

balances_bp = Blueprint('balances', __name__)
balance_service = BalanceService()


def _balances_dict(daily):
    """An account's DailyBalances as the API returns them, in dollars and cents."""
    return {
        'id':            daily.account.id,
        'account_name':  daily.account.acct_name,
        'opening':       daily.opening_cents / 100,
        'opening_cents': daily.opening_cents,
        'days':          [{'date': day.isoformat(), 'balance': cents / 100, 'balance_cents': cents}
                          for day, cents in daily.days],
        'closing':       daily.closing_cents / 100,
        'closing_cents': daily.closing_cents,
    }


@balances_bp.route('', methods=['GET'])
@jwt_required()
def get_balances():
    """Each account's balance before start_date and at the end of each date with transactions through end_date."""
    try:
        filters = parse_export_filters(request.args)
        balances = balance_service.daily_balances(
            get_jwt_identity(), filters.account_ids, filters.start_date, filters.end_date)
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    return jsonify({'success': True, 'balances': [_balances_dict(daily) for daily in balances]}), 200
