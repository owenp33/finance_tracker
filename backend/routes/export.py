"""
export.py - Export downloads: the transactions CSV and the PDF report

Thin routes: parse the filters (a bad one is a 400), let ReportService build the file, send it.
"""
from flask import Blueprint, request, jsonify, Response
from flask_jwt_extended import jwt_required, get_jwt_identity
from services.reports import ReportService, parse_export_filters

export_bp = Blueprint('export', __name__)
report_service = ReportService()


def _download(content, mimetype, filename):
    return Response(content, mimetype=mimetype,
                    headers={'Content-Disposition': f'attachment; filename={filename}'})


@export_bp.route('/transactions.csv', methods=['GET'])
@jwt_required()
def export_transactions_csv():
    """Transactions (scoped by account_ids / start_date / end_date) as CSV."""
    try:
        filters = parse_export_filters(request.args)
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    return _download(report_service.csv(get_jwt_identity(), filters), 'text/csv', 'transactions.csv')


@export_bp.route('/report.pdf', methods=['GET'])
@jwt_required()
def export_report_pdf():
    """The PDF report (scoped by account_ids / start_date / end_date / categories)."""
    try:
        filters = parse_export_filters(request.args)
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    return _download(report_service.pdf(get_jwt_identity(), filters), 'application/pdf', 'report.pdf')
