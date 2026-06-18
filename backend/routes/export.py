"""
export.py - CSV transaction export and PDF report generation routes
"""
import csv
import io
from datetime import datetime

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages

from flask import Blueprint, request, Response
from flask_jwt_extended import jwt_required, get_jwt_identity

from services import DbService, AnalyticsService

export_bp = Blueprint('export', __name__)
db_service = DbService()


def _parse_account_ids(raw):
    if not raw:
        return None
    return [int(x) for x in raw.split(',') if x.strip()]


def _parse_date(raw):
    return datetime.fromisoformat(raw).date() if raw else None


@export_bp.route('/transactions.csv', methods=['GET'])
@jwt_required()
def export_transactions_csv():
    """Export raw transactions (scoped by account_ids / start_date / end_date) as CSV."""
    user_id = get_jwt_identity()
    account_ids = _parse_account_ids(request.args.get('account_ids'))
    start_date = _parse_date(request.args.get('start_date'))
    end_date = _parse_date(request.args.get('end_date'))

    transactions = db_service.get_user_transactions_filtered(
        user_id, account_ids=account_ids, start_date=start_date, end_date=end_date
    )

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(['date', 'vendor', 'category', 'amount', 'account', 'notes', 'is_transfer', 'is_reimbursement'])
    for t in transactions:
        writer.writerow([
            t.date.isoformat(),
            t.vendor,
            t.category,
            t.amount,
            t.account.acct_name if t.account else '',
            t.notes or '',
            t.is_transfer,
            t.is_reimbursement,
        ])

    return Response(
        buf.getvalue(),
        mimetype='text/csv',
        headers={'Content-Disposition': 'attachment; filename=transactions.csv'},
    )


@export_bp.route('/report.pdf', methods=['GET'])
@jwt_required()
def export_report_pdf():
    """Generate a multi-page analytics PDF (scoped by account_ids / start_date / end_date / categories)."""
    user_id = get_jwt_identity()
    account_ids = _parse_account_ids(request.args.get('account_ids'))
    start_date = _parse_date(request.args.get('start_date'))
    end_date = _parse_date(request.args.get('end_date'))
    categories_raw = request.args.get('categories')
    categories = set(c for c in categories_raw.split(',') if c.strip()) if categories_raw else None

    transactions = db_service.get_user_transactions_filtered(
        user_id, account_ids=account_ids, start_date=start_date, end_date=end_date
    )
    if categories:
        transactions = [t for t in transactions if t.category in categories]

    analytics = AnalyticsService.generate_report(transactions)

    period_label = f"{start_date.isoformat() if start_date else 'earliest'} to {end_date.isoformat() if end_date else 'latest'}"
    generated_label = datetime.now().strftime('%Y-%m-%d %H:%M')

    buf = io.BytesIO()
    with PdfPages(buf) as pdf:
        _render_summary_page(pdf, analytics, period_label, generated_label)
        _render_monthly_trends_page(pdf, analytics)
        _render_category_pie_page(pdf, analytics['spending_by_category'], 'Spending by Category')
        _render_category_pie_page(pdf, analytics['income_by_category'], 'Income by Category')
        _render_top_vendors_page(pdf, analytics['top_vendors'])
        _render_breakdown_table_page(pdf, analytics['spending_by_category'])

    return Response(
        buf.getvalue(),
        mimetype='application/pdf',
        headers={'Content-Disposition': 'attachment; filename=report.pdf'},
    )


# PDF PAGE BUILDERS ==============================================================

def _render_summary_page(pdf, analytics, period_label, generated_label):
    summary = analytics['summary']
    trends = analytics['trends']

    fig, ax = plt.subplots(figsize=(8.5, 11))
    ax.axis('off')

    lines = [
        ('Financial Report', 20, 'bold'),
        (f'Period: {period_label}', 12, 'normal'),
        (f'Generated: {generated_label}', 10, 'normal'),
        ('', 12, 'normal'),
        (f"Total Income: ${summary['total_income']:,.2f}", 14, 'normal'),
        (f"Total Expenses: ${summary['total_expenses']:,.2f}", 14, 'normal'),
        (f"Net Amount: ${summary['net_amount']:,.2f}", 14, 'normal'),
        (f"Transactions: {summary['transaction_count']}", 12, 'normal'),
        (f"Average Transaction: ${summary['avg_transaction']:,.2f}", 12, 'normal'),
        ('', 12, 'normal'),
        (f"Avg Weekly Income: ${trends['weekly_avg_income']:,.2f}", 12, 'normal'),
        (f"Avg Weekly Expenses: ${trends['weekly_avg_expenses']:,.2f}", 12, 'normal'),
    ]

    y = 0.95
    for text, size, weight in lines:
        ax.text(0.05, y, text, fontsize=size, fontweight=weight, transform=ax.transAxes)
        y -= 0.05 if size <= 12 else 0.07

    pdf.savefig(fig)
    plt.close(fig)


def _render_monthly_trends_page(pdf, analytics):
    monthly = list(reversed(analytics['monthly_summary']))

    fig, ax = plt.subplots(figsize=(11, 8.5))
    if monthly:
        months = [m['month'] for m in monthly]
        ax.plot(months, [m['income'] for m in monthly], marker='o', label='Income', color='#00C49F')
        ax.plot(months, [m['expenses'] for m in monthly], marker='o', label='Expenses', color='#FF8042')
        ax.plot(months, [m['net'] for m in monthly], marker='o', label='Net', color='#0088FE')
        ax.set_xticklabels(months, rotation=45, ha='right')
        ax.legend()
        ax.set_ylabel('Amount ($)')
    else:
        ax.text(0.5, 0.5, 'No monthly data available', ha='center', va='center', transform=ax.transAxes)
        ax.axis('off')
    ax.set_title('Monthly Trends')
    fig.tight_layout()
    pdf.savefig(fig)
    plt.close(fig)


def _render_category_pie_page(pdf, rows, title):
    fig, ax = plt.subplots(figsize=(8.5, 8.5))
    if rows:
        labels = [r['category'] for r in rows]
        values = [r['total'] for r in rows]
        colors = plt.get_cmap('tab20').colors
        ax.pie(values, labels=labels, autopct='%1.1f%%', colors=colors)
    else:
        ax.text(0.5, 0.5, 'No data available', ha='center', va='center', transform=ax.transAxes)
        ax.axis('off')
    ax.set_title(title)
    fig.tight_layout()
    pdf.savefig(fig)
    plt.close(fig)


def _render_top_vendors_page(pdf, vendors):
    fig, ax = plt.subplots(figsize=(11, 8.5))
    if vendors:
        names = [v['vendor'] for v in vendors][::-1]
        amounts = [v['amount'] for v in vendors][::-1]
        ax.barh(names, amounts, color='#FF8042')
        ax.set_xlabel('Amount ($)')
    else:
        ax.text(0.5, 0.5, 'No vendor data available', ha='center', va='center', transform=ax.transAxes)
        ax.axis('off')
    ax.set_title('Top 10 Vendors by Spending')
    fig.tight_layout()
    pdf.savefig(fig)
    plt.close(fig)


def _render_breakdown_table_page(pdf, rows):
    fig, ax = plt.subplots(figsize=(8.5, 11))
    ax.axis('off')
    ax.set_title('Spending Breakdown', pad=20)

    if rows:
        table_data = [[r['category'], f"${r['total']:.2f}", f"${r['average']:.2f}", r['count'], f"{r['percentage']}%"] for r in rows]
        table = ax.table(
            cellText=table_data,
            colLabels=['Category', 'Total', 'Average', 'Count', 'Percentage'],
            loc='center',
            cellLoc='center',
        )
        table.auto_set_font_size(False)
        table.set_fontsize(9)
        table.scale(1, 1.5)
    else:
        ax.text(0.5, 0.5, 'No data available', ha='center', va='center', transform=ax.transAxes)

    pdf.savefig(fig)
    plt.close(fig)
