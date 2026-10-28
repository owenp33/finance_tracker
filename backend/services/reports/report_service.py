"""
report_service.py - Builds the export files: the transactions CSV and the PDF report

Selects what an export covers from the account ledgers (BalanceService) and turns it into a file
named after its period; routes only parse the filters and send the result.
"""
import io
from dataclasses import dataclass
from datetime import datetime
from services.analytics_service import AnalyticsService
from services.balance_service import BalanceService
from services.budget_flag_service import BudgetFlagService
from services.reports import pdf_pages
from services.reports.csv_export import ledger_csv
from matplotlib.backends.backend_pdf import PdfPages   # after pdf_pages, which picks the backend

balance_service = BalanceService()
budget_flag_service = BudgetFlagService()

NOTHING_TO_EXPORT = 'No transactions in this period.'


@dataclass(frozen=True)
class ExportFile:
    """A finished export: what to send, and the name to save it under."""
    content: str | bytes
    mimetype: str
    filename: str


def _period(filters, ledgers):
    """The export's date range: the chosen dates, an open side filled from its first or last transaction."""
    start = filters.start_date or min(ledger.rows[0].transaction.date for ledger in ledgers)
    end = filters.end_date or max(ledger.rows[-1].transaction.date for ledger in ledgers)
    return start, end


def _by_date(ledgers):
    """Every LedgerRow in the ledgers, by date, then account, then the order they were added."""
    rows = [row for ledger in ledgers for row in ledger.rows]
    return sorted(rows, key=lambda r: (r.transaction.date, r.transaction.account_id, r.transaction.id))


class ReportService:

    def csv(self, user_id, filters):
        """Every transaction the export covers, by date, with its account's running balance."""
        ledgers = self._ledgers(user_id, filters)
        start, end = _period(filters, ledgers)
        return ExportFile(ledger_csv(_by_date(ledgers)), 'text/csv', f'transactions_{start}_to_{end}.csv')

    def pdf(self, user_id, filters, generated_at=None):
        """
        The PDF report: six summary pages (summary, trends, pies, top vendors, breakdown), then
        each account's pages (balance chart over the period, transaction table with running
        balances, over-budget transactions marked).
        """
        ledgers = self._ledgers(user_id, filters)
        start, end = _period(filters, ledgers)
        transactions = [row.transaction for row in _by_date(ledgers)]
        analytics = AnalyticsService.generate_report(transactions)
        over_budget_ids = budget_flag_service.over_budget_ids(user_id, transactions)
        period_label = f'{start} to {end}'
        generated_label = (generated_at or datetime.now()).strftime('%Y-%m-%d %H:%M')

        buf = io.BytesIO()
        with PdfPages(buf) as pdf:
            pdf_pages.render_summary_page(pdf, analytics, period_label, generated_label)
            pdf_pages.render_monthly_trends_page(pdf, analytics)
            pdf_pages.render_category_pie_page(pdf, analytics['spending_by_category'], 'Spending by Category')
            pdf_pages.render_category_pie_page(pdf, analytics['income_by_category'], 'Income by Category')
            pdf_pages.render_top_vendors_page(pdf, analytics['top_vendors'])
            pdf_pages.render_breakdown_table_page(pdf, analytics['spending_by_category'])
            for ledger in ledgers:
                pdf_pages.render_account_pages(pdf, ledger, over_budget_ids, period_label, start, end)
        return ExportFile(buf.getvalue(), 'application/pdf', f'report_{start}_to_{end}.pdf')

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
