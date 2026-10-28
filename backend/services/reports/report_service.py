"""
report_service.py - Builds the export files: the transactions CSV and the PDF report

Fetches the user's transactions for an ExportFilters and turns them into a file; routes only parse
the filters and send the result.
"""
import io
from datetime import datetime
from services.analytics_service import AnalyticsService
from services.db_service import DbService
from services.reports import pdf_pages
from services.reports.csv_export import transactions_csv
from matplotlib.backends.backend_pdf import PdfPages   # after pdf_pages, which picks the backend

db_service = DbService()


def _period_label(filters):
    start = filters.start_date.isoformat() if filters.start_date else 'earliest'
    end = filters.end_date.isoformat() if filters.end_date else 'latest'
    return f'{start} to {end}'


class ReportService:

    def csv(self, user_id, filters):
        """Every transaction the filters cover, oldest first, as CSV text (categories are ignored)."""
        return transactions_csv(self._transactions(user_id, filters))

    def pdf(self, user_id, filters, generated_at=None):
        """The PDF report (summary, trends, pies, top vendors, breakdown) as bytes."""
        transactions = self._transactions(user_id, filters)
        if filters.categories:
            transactions = [t for t in transactions if t.category in filters.categories]
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

    def _transactions(self, user_id, filters):
        return db_service.get_user_transactions_filtered(
            user_id, account_ids=filters.account_ids, start_date=filters.start_date, end_date=filters.end_date
        )
