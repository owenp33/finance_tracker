"""
report_service.py - Builds the export files: the transactions CSV and the PDF report

Selects what an export covers from the account ledgers (BalanceService) and turns it into a file;
routes only parse the filters and send the result.
"""
import io
from datetime import datetime
from services.analytics_service import AnalyticsService
from services.balance_service import BalanceService
from services.reports import pdf_pages
from services.reports.csv_export import ledger_csv
from matplotlib.backends.backend_pdf import PdfPages   # after pdf_pages, which picks the backend

balance_service = BalanceService()

NOTHING_TO_EXPORT = 'No transactions in this period.'


def _period_label(filters):
    start = filters.start_date.isoformat() if filters.start_date else 'earliest'
    end = filters.end_date.isoformat() if filters.end_date else 'latest'
    return f'{start} to {end}'


def _by_date(ledgers):
    """Every LedgerRow in the ledgers, by date, then account, then the order they were added."""
    rows = [row for ledger in ledgers for row in ledger.rows]
    return sorted(rows, key=lambda r: (r.transaction.date, r.transaction.account_id, r.transaction.id))


class ReportService:

    def csv(self, user_id, filters):
        """Every transaction the export covers, by date, with its account's running balance, as CSV text."""
        return ledger_csv(_by_date(self._ledgers(user_id, filters)))

    def pdf(self, user_id, filters, generated_at=None):
        """The PDF report (summary, trends, pies, top vendors, breakdown) as bytes."""
        transactions = [row.transaction for row in _by_date(self._ledgers(user_id, filters))]
        analytics = AnalyticsService.generate_report(transactions)
        generated_label = (generated_at or datetime.now()).strftime('%Y-%m-%d %H:%M')

        buf = io.BytesIO()
        with PdfPages(buf) as pdf:
            pdf_pages.render_summary_page(pdf, analytics, _period_label(filters), generated_label)
            pdf_pages.render_monthly_trends_page(pdf, analytics)
            pdf_pages.render_category_pie_page(pdf, analytics['spending_by_category'], 'Spending by Category')
            pdf_pages.render_category_pie_page(pdf, analytics['income_by_category'], 'Income by Category')
            pdf_pages.render_top_vendors_page(pdf, analytics['top_vendors'])
            pdf_pages.render_breakdown_table_page(pdf, analytics['spending_by_category'])
        return buf.getvalue()

    def _ledgers(self, user_id, filters):
        """
        The ledgers an export covers: the chosen accounts (default: all of the user's) that have
        transactions in the period. Raises ValueError when none do, or for an account that isn't
        the user's.
        """
        ledgers = [
            ledger for ledger in balance_service.ledgers(
                user_id, filters.account_ids, filters.start_date, filters.end_date)
            if ledger.rows
        ]
        if not ledgers:
            raise ValueError(NOTHING_TO_EXPORT)
        return ledgers
