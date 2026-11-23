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
from services.db_service import DbService
from services.reports import pdf_pages, summary_data
from services.reports.csv_export import ledger_csv
from matplotlib.backends.backend_pdf import PdfPages   # after pdf_pages, which picks the backend

balance_service = BalanceService()
budget_flag_service = BudgetFlagService()
db_service = DbService()

NOTHING_TO_EXPORT = 'No transactions in this period.'
MIN_NET_MONTHS = 2   # net per month needs two months; one month's totals are already on the summary page


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
    return sorted(rows, key=lambda r: (r.transaction.date, r.account.id, r.transaction.id))


class ReportService:

    def csv(self, user_id, filters):
        """Every transaction the export covers, by date, with its account's running balance."""
        ledgers = self._ledgers(user_id, filters)
        start, end = _period(filters, ledgers)
        return ExportFile(ledger_csv(_by_date(ledgers)), 'text/csv', f'transactions_{start}_to_{end}.csv')

    def pdf(self, user_id, filters, generated_at=None):
        """
        The PDF report: the summary pages (the summary with income as one line, net per month
        when the period covers at least MIN_NET_MONTHS months, spending by category, top vendors,
        and the chosen accounts' recurring costs as of today when there are any), then each
        account's pages
        (balance chart over the period, transaction table with running balances, over-budget
        transactions marked). `generated_at` (default now) is printed, and its date is today.
        """
        ledgers = self._ledgers(user_id, filters)
        start, end = _period(filters, ledgers)
        # Each transaction once: a loan's payment rows repeat a payment already in its own account
        transactions = [row.transaction for row in _by_date(ledgers) if not row.loan_payment]
        analytics = AnalyticsService.generate_report(transactions)
        over_budget_ids = budget_flag_service.over_budget_ids(user_id, transactions)
        generated_at = generated_at or datetime.now()
        months, partial = summary_data.period_months(
            transactions, filters.start_date, filters.end_date, generated_at.date())
        period_label = f'{start} to {end}'
        generated_label = generated_at.strftime('%Y-%m-%d %H:%M')

        buf = io.BytesIO()
        with PdfPages(buf) as pdf:
            pdf_pages.render_summary_page(pdf, analytics, period_label, generated_label,
                                          summary_data.largest_income(transactions))
            if len(months) >= MIN_NET_MONTHS:
                pdf_pages.render_net_per_month_pages(
                    pdf, summary_data.monthly_net(transactions, months, partial), period_label)
            pdf_pages.render_spending_by_category_page(
                pdf, summary_data.category_panels(transactions, months, partial), period_label)
            pdf_pages.render_top_vendors_page(pdf, summary_data.top_vendors(transactions), period_label)
            self._recurring_costs_page(pdf, user_id, filters, generated_at.date())
            for ledger in ledgers:
                pdf_pages.render_account_pages(pdf, ledger, over_budget_ids, period_label, start, end)
        return ExportFile(buf.getvalue(), 'application/pdf', f'report_{start}_to_{end}.pdf')

    def _recurring_costs_page(self, pdf, user_id, filters, today):
        """
        The recurring costs page for the chosen accounts' templates (default: all of the user's),
        from every payment in their series, not just the period's; none without a cost series.
        """
        templates = [t for t in db_service.get_user_recurring(user_id)
                     if not filters.account_ids or t.account_id in filters.account_ids]
        payments = [payment for template in templates for payment in template.generated_transactions]
        costs = summary_data.recurring_costs(templates, payments, today)
        if costs['series']:
            account_names = {template.account_id: template.account.acct_name for template in templates}
            pdf_pages.render_recurring_costs_page(pdf, costs, account_names, today)

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
