"""
Export tests: what an export covers, the CSV download, and the PDF report.
"""
import csv
import io
import math
import re
import warnings
from datetime import date, datetime, timedelta
from types import SimpleNamespace

import pytest
from matplotlib.colors import to_hex

from extensions import db as _db
from models.account import AccountModel
from models.user import User
from services.account_service import AccountService
from services.analytics_service import AnalyticsService
from services.balance_service import LedgerRow
from services.budget_service import BudgetService
from services.reports import ExportFilters, ReportService, pdf_pages

account_svc = AccountService()

CSV_URL = '/api/export/transactions.csv'
CSV_HEADER = ['Bank Account', 'Date', 'Vendor', 'Category', 'Notes', 'Income', 'Expense', 'Running balance']
PDF_URL = '/api/export/report.pdf'
BOTH = pytest.mark.parametrize('url', [CSV_URL, PDF_URL], ids=['csv', 'pdf'])


@pytest.fixture
def savings(user):
    a = AccountModel(user_id=user.id, acct_id_str='savings-1', acct_name='Savings')
    _db.session.add(a)
    _db.session.commit()
    return a


@pytest.fixture
def ledger(account, savings):
    """Four transactions across two accounts and January–February 2026."""
    add = account_svc.add_transaction
    return [
        add(account.id, date(2026, 1, 5), 'Grocer', 'Groceries', -42.10, notes='weekly'),
        add(savings.id, date(2026, 1, 15), 'Interest', 'Income', 3.25),
        add(account.id, date(2026, 2, 1), 'To savings', 'Transfer', -100.0, is_transfer=True),
        add(account.id, date(2026, 2, 20), 'Refund', 'Groceries', 10.0, is_reimbursement=True),
    ]


def _csv_rows(resp):
    return list(csv.reader(io.StringIO(resp.get_data(as_text=True))))


def _column(resp, name):
    """One CSV column's values, header left out."""
    header, *rows = _csv_rows(resp)
    return [row[header.index(name)] for row in rows]


def _preview_import(client, headers, content):
    data = {'file': (io.BytesIO(content), 'transactions.csv', 'text/csv')}
    return client.post('/api/import/preview', data=data, headers=headers, content_type='multipart/form-data')


def _pdf_pages(resp):
    return len(re.findall(rb'/Type\s*/Page[^s]', resp.data))


@pytest.fixture
def risky(user):
    """An account and a transaction whose text a spreadsheet would run as formulas."""
    card = AccountModel(user_id=user.id, acct_id_str='card-1', acct_name='-Card')
    _db.session.add(card)
    _db.session.commit()
    account_svc.add_transaction(card.id, date(2026, 1, 5), '=HYPERLINK("http://evil.example","x")', '+Cat',
                                -5.0, notes='@SUM(1)')
    return card


@pytest.fixture
def account_sections(monkeypatch):
    """Per account section of each PDF: (account name, its vendors, the vendors marked over budget)."""
    seen = []
    real = pdf_pages.render_account_pages

    def spy(pdf, ledger, over_budget_ids, *args):
        vendors = [r.transaction.vendor for r in ledger.rows]
        flagged = [r.transaction.vendor for r in ledger.rows if r.transaction.id in over_budget_ids]
        seen.append((ledger.account.acct_name, vendors, flagged))
        return real(pdf, ledger, over_budget_ids, *args)

    monkeypatch.setattr(pdf_pages, 'render_account_pages', spy)
    return seen


@pytest.fixture
def net_pages(monkeypatch):
    """Each PDF's net per month rows: (month, money in, money out, net, partial?)."""
    seen = []
    real = pdf_pages.render_net_per_month_pages

    def spy(pdf, rows, *args):
        seen.append([(r['month'], r['income'], r['expenses'], r['net'], r['partial']) for r in rows])
        return real(pdf, rows, *args)

    monkeypatch.setattr(pdf_pages, 'render_net_per_month_pages', spy)
    return seen


@pytest.fixture
def reported(monkeypatch):
    """The vendors of the transactions each PDF report was built from, in order."""
    seen = []
    real = AnalyticsService.generate_report
    monkeypatch.setattr(AnalyticsService, 'generate_report',
                        staticmethod(lambda txs: seen.append([t.vendor for t in txs]) or real(txs)))
    return seen


class TestCsvExport:
    def test_requires_login(self, client):
        assert client.get(CSV_URL).status_code == 401

    def test_every_transaction_by_date_with_its_accounts_running_balance(self, client, auth_headers, ledger):
        resp = client.get(CSV_URL, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.mimetype == 'text/csv'
        assert resp.headers['Content-Disposition'] == 'attachment; filename=transactions_2026-01-05_to_2026-02-20.csv'
        assert _csv_rows(resp) == [
            CSV_HEADER,
            ['Test Checking', '2026-01-05', 'Grocer', 'Groceries', 'weekly', '', '42.10', '-42.10'],
            ['Savings', '2026-01-15', 'Interest', 'Income', '', '3.25', '', '3.25'],
            ['Test Checking', '2026-02-01', 'To savings', 'Transfer', '', '', '100.00', '-142.10'],
            ['Test Checking', '2026-02-20', 'Refund', 'Groceries', '', '10.00', '', '-132.10'],
        ]

    def test_running_balances_include_the_starting_balance_and_earlier_transactions(
            self, client, auth_headers, ledger, account):
        account_svc.update_account(account.id, {'opening_balance': 500})
        resp = client.get(f'{CSV_URL}?account_ids={account.id}&start_date=2026-02-01', headers=auth_headers)
        assert _column(resp, 'Running balance') == ['357.90', '367.90']

    def test_a_zero_amount_is_income(self, client, auth_headers, account):
        account_svc.add_transaction(account.id, date(2026, 3, 1), 'Fee waived', 'Fees', 0.0)
        resp = client.get(CSV_URL, headers=auth_headers)
        assert (_column(resp, 'Income'), _column(resp, 'Expense')) == (['0.00'], [''])

    def test_accounts_and_dates_narrow_it(self, client, auth_headers, ledger, account):
        resp = client.get(f'{CSV_URL}?account_ids={account.id}&start_date=2026-01-06&end_date=2026-02-01',
                          headers=auth_headers)
        assert _column(resp, 'Vendor') == ['To savings']

    def test_text_a_spreadsheet_would_run_gets_an_apostrophe(self, client, auth_headers, risky):
        assert _csv_rows(client.get(CSV_URL, headers=auth_headers))[1] == [
            "'-Card", '2026-01-05', '\'=HYPERLINK("http://evil.example","x")', "'+Cat", "'@SUM(1)", '', '5.00', '-5.00',
        ]

    def test_an_empty_account_list_means_every_account(self, client, auth_headers, ledger):
        assert len(_csv_rows(client.get(f'{CSV_URL}?account_ids=,', headers=auth_headers))) == 5


class TestCsvRoundTrip:
    """The CSV can be imported again: every row is recognized as a transaction already there."""

    def test_importing_it_again_finds_only_duplicates(self, client, auth_headers, ledger, account):
        account_svc.add_transaction(account.id, date(2026, 2, 21), 'Joe\'s "Diner", LLC', 'Food', -12.5,
                                    notes='split, two lines\nsecond line')
        resp = _preview_import(client, auth_headers, client.get(CSV_URL, headers=auth_headers).data)
        assert resp.status_code == 200
        assert [(r['account_name'], r['date'], r['vendor'], r['category'], r['amount'], r['notes'], r['duplicate'])
                for r in resp.json['rows']] == [
            ('Test Checking', '2026-01-05', 'Grocer', 'Groceries', -42.1, 'weekly', True),
            ('Savings', '2026-01-15', 'Interest', 'Income', 3.25, '', True),
            ('Test Checking', '2026-02-01', 'To savings', 'Transfer', -100.0, '', True),
            ('Test Checking', '2026-02-20', 'Refund', 'Groceries', 10.0, '', True),
            ('Test Checking', '2026-02-21', 'Joe\'s "Diner", LLC', 'Food', -12.5, 'split, two lines\nsecond line', True),
        ]
        assert resp.json['summary']['importable'] == 0

    def test_guarded_text_comes_back_as_it_was(self, client, auth_headers, risky):
        resp = _preview_import(client, auth_headers, client.get(CSV_URL, headers=auth_headers).data)
        assert [(r['account_name'], r['vendor'], r['category'], r['notes'], r['duplicate'])
                for r in resp.json['rows']] == [
            ('-Card', '=HYPERLINK("http://evil.example","x")', '+Cat', '@SUM(1)', True),
        ]

    def test_a_zero_amount_comes_back_as_a_zero_amount(self, client, auth_headers, account):
        account_svc.add_transaction(account.id, date(2026, 3, 1), 'Fee waived', 'Fees', 0.0)
        resp = _preview_import(client, auth_headers, client.get(CSV_URL, headers=auth_headers).data)
        assert [(r['amount'], r['zero_amount'], r['invalid_amount']) for r in resp.json['rows']] == [(0.0, True, False)]


class TestPdfReport:
    def test_requires_login(self, client):
        assert client.get(PDF_URL).status_code == 401

    def test_four_summary_pages_then_a_page_per_account(self, client, auth_headers, ledger):
        resp = client.get(PDF_URL, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.mimetype == 'application/pdf'
        assert resp.headers['Content-Disposition'] == 'attachment; filename=report_2026-01-05_to_2026-02-20.pdf'
        assert resp.data.startswith(b'%PDF')
        assert _pdf_pages(resp) == 4 + 2

    def test_a_long_account_continues_on_more_pages(self, client, auth_headers, account):
        for i in range(pdf_pages.FIRST_PAGE_ROWS + 1):   # every third day, so January to March
            account_svc.add_transaction(account.id, date(2026, 1, 1) + timedelta(days=3 * i), f'Shop {i}', 'Misc', -1.0)
        assert _pdf_pages(client.get(PDF_URL, headers=auth_headers)) == 4 + 2

    @pytest.mark.parametrize('query, pages', [
        ('start_date=2026-01-01&end_date=2026-01-31', 3 + 2),
        ('start_date=2026-01-15&end_date=2026-02-25', 4 + 2),
    ], ids=['one-month', 'two-part-months'])
    def test_net_per_month_only_with_two_months(self, client, auth_headers, ledger, query, pages):
        assert _pdf_pages(client.get(f'{PDF_URL}?{query}', headers=auth_headers)) == pages

    def test_net_per_month_counts_the_reports_transactions_as_insights_does(self, client, auth_headers, ledger,
                                                                            net_pages):
        client.get(PDF_URL, headers=auth_headers)
        assert net_pages == [[
            ('2026-01', 325, 4210, -3885, False),
            ('2026-02', 1000, 0, 1000, False),   # the reimbursement is money in; the transfer never counts
        ]]

    def test_the_month_the_report_is_made_in_is_partial(self, user, ledger, net_pages):
        ReportService().pdf(user.id, ExportFilters(), generated_at=datetime(2026, 2, 21, 9, 30))
        assert [month[-1] for month in net_pages[0]] == [False, True]

    def test_a_long_period_continues_net_per_month_on_more_pages(self, client, auth_headers, ledger):
        resp = client.get(f'{PDF_URL}?start_date=2024-01-01&end_date=2026-02-28', headers=auth_headers)
        assert _pdf_pages(resp) == 5 + 2   # 26 months: FIRST_PAGE_ROWS under the chart, the rest on a page

    def test_spending_by_category_and_the_income_line_count_the_reports_transactions(self, client, auth_headers,
                                                                                    ledger, monkeypatch):
        seen = {}
        real_summary, real_spending = pdf_pages.render_summary_page, pdf_pages.render_spending_by_category_page

        def summary(pdf, analytics, period_label, generated_label, income):
            seen['income'] = income
            return real_summary(pdf, analytics, period_label, generated_label, income)

        def spending(pdf, panels, period_label):
            seen['panels'] = [(p['category'], p['total'], p['count'], [m['cents'] for m in p['months']])
                              for p in panels]
            return real_spending(pdf, panels, period_label)

        monkeypatch.setattr(pdf_pages, 'render_summary_page', summary)
        monkeypatch.setattr(pdf_pages, 'render_spending_by_category_page', spending)
        client.get(PDF_URL, headers=auth_headers)
        assert seen == {
            'income': {'category': 'Groceries', 'cents': 1000, 'total': 1325, 'categories': 2},   # the refund
            'panels': [('Groceries', 4210, 1, [4210, 0])],   # plain spending; the transfer never counts
        }

    def test_each_account_with_activity_gets_a_section(self, client, auth_headers, ledger, account_sections):
        client.get(f'{PDF_URL}?start_date=2026-01-10', headers=auth_headers)
        assert account_sections == [
            ('Test Checking', ['To savings', 'Refund'], []),
            ('Savings', ['Interest'], []),
        ]

    def test_accounts_without_activity_get_no_section(self, client, auth_headers, ledger, account_sections):
        client.get(f'{PDF_URL}?start_date=2026-02-01', headers=auth_headers)
        assert [name for name, _, _ in account_sections] == ['Test Checking']

    def test_over_budget_transactions_are_marked(self, client, auth_headers, ledger, user, account_sections):
        BudgetService().create_budget(user.id, 'Groceries', '2026-01', 40.0)
        client.get(PDF_URL, headers=auth_headers)
        assert account_sections[0] == ('Test Checking', ['Grocer', 'To savings', 'Refund'], ['Grocer'])

    def test_accounts_and_dates_choose_what_it_covers(self, client, auth_headers, ledger, account, reported):
        client.get(f'{PDF_URL}?account_ids={account.id}&start_date=2026-01-06', headers=auth_headers)
        assert reported == [['To savings', 'Refund']]


NOTHING = (400, {'success': False, 'error': 'No transactions in this period.'})


class TestPeriod:
    """An export's period is the chosen dates, an open side filled from its first or last transaction."""

    @pytest.mark.parametrize('query, start, end', [
        ('', '2026-01-05', '2026-02-20'),
        ('start_date=2026-01-01&end_date=2026-03-31', '2026-01-01', '2026-03-31'),
        ('start_date=2026-01-10', '2026-01-10', '2026-02-20'),
        ('end_date=2026-01-31', '2026-01-05', '2026-01-31'),
    ], ids=['no-dates', 'both-dates', 'start-only', 'end-only'])
    def test_files_are_named_after_it(self, client, auth_headers, ledger, query, start, end):
        csv_resp = client.get(f'{CSV_URL}?{query}', headers=auth_headers)
        pdf_resp = client.get(f'{PDF_URL}?{query}', headers=auth_headers)
        assert csv_resp.headers['Content-Disposition'] == f'attachment; filename=transactions_{start}_to_{end}.csv'
        assert pdf_resp.headers['Content-Disposition'] == f'attachment; filename=report_{start}_to_{end}.pdf'

    def test_the_pdf_prints_it_and_every_account_chart_covers_it(self, client, auth_headers, ledger, monkeypatch):
        seen = []
        real_summary, real_account = pdf_pages.render_summary_page, pdf_pages.render_account_pages

        def summary(pdf, analytics, period_label, *rest):
            seen.append(('summary', period_label))
            return real_summary(pdf, analytics, period_label, *rest)

        def account(pdf, ledger, over_budget_ids, period_label, start, end):
            seen.append((ledger.account.acct_name, period_label, start, end))
            return real_account(pdf, ledger, over_budget_ids, period_label, start, end)

        monkeypatch.setattr(pdf_pages, 'render_summary_page', summary)
        monkeypatch.setattr(pdf_pages, 'render_account_pages', account)
        client.get(PDF_URL, headers=auth_headers)
        period = '2026-01-05 to 2026-02-20'
        assert seen == [
            ('summary', period),
            ('Test Checking', period, date(2026, 1, 5), date(2026, 2, 20)),
            ('Savings', period, date(2026, 1, 5), date(2026, 2, 20)),
        ]


class _Pages:
    """Stands in for PdfPages: draws each page and keeps its figure to look at."""

    def __init__(self):
        self.figures = []

    def savefig(self, fig):
        fig.canvas.draw()
        self.figures.append(fig)


def _table_cells(ax):
    """A page table's text, row by row."""
    cells = ax.tables[0].get_celld()
    rows, columns = max(r for r, _ in cells) + 1, max(c for _, c in cells) + 1
    return [[cells[r, c].get_text().get_text() for c in range(columns)] for r in range(rows)]


class TestSummaryPage:
    """The totals, with income by category as one line under them."""

    ANALYTICS = {   # AnalyticsService.generate_report's summary and trends
        'summary': {'total_income': 4050.0, 'total_expenses': 1200.0, 'net_amount': 2850.0,
                    'transaction_count': 12, 'avg_transaction': 437.5},
        'trends': {'weekly_avg_income': 500.0, 'weekly_avg_expenses': 150.0},
    }

    def lines(self, income):
        pages = _Pages()
        pdf_pages.render_summary_page(pages, self.ANALYTICS, '2026-09-01 to 2026-10-31', '2026-11-12 09:30', income)
        return [t.get_text() for t in pages.figures[0].axes[0].texts]

    def test_income_is_one_line_naming_its_largest_category(self):
        lines = self.lines({'category': 'Paycheck', 'cents': 400000, 'total': 405000, 'categories': 2})
        assert lines[lines.index('Net Amount: $2,850.00') + 1] == (
            'Largest income category: Paycheck, $4,000.00 of $4,050.00 (99%)')

    def test_with_one_income_category_it_says_so(self):
        lines = self.lines({'category': 'Paycheck', 'cents': 405000, 'total': 405000, 'categories': 1})
        assert lines[lines.index('Net Amount: $2,850.00') + 1] == 'All income is in one category: Paycheck ($4,050.00)'

    def test_without_income_there_is_no_line(self):
        assert [line for line in self.lines(None) if 'income category' in line] == []


def _panel(category, cents, average, last, count, others=None):
    """A summary_data.category_panels panel over Sep–Nov 2026, November so far; `last` is October's cents."""
    months = ['2026-09', '2026-10', '2026-11']
    return {
        'category': category, **({'others': others} if others else {}), 'total': sum(cents), 'count': count,
        'months': [{'month': m, 'cents': c, 'partial': m == '2026-11'} for m, c in zip(months, cents)],
        'average': average, 'last': None if last is None else {'month': '2026-10', 'cents': last},
    }


class TestSpendingByCategoryPage:
    """Spending by category as the app's Insights Overview draws it: small multiples and a table."""

    PANELS = [
        _panel('Rent', [90000, 90000, 90000], 90000, 90000, 3),
        _panel('Groceries', [30000, 40000, 10000], 35000, 40000, 3),
        _panel('Medical', [8700, 0, 0], 4350, 0, 1),
        _panel('Other', [1500, 2500, 0], 2000, 2500, 2, others=['Gifts', 'Pets']),
    ]

    def render(self, panels):
        pages = _Pages()
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter('always')
            pdf_pages.render_spending_by_category_page(pages, panels, '2026-09-01 to 2026-11-12')
        assert [str(w.message) for w in caught if issubclass(w.category, UserWarning)] == []
        (page,) = pages.figures
        return page

    def test_a_small_chart_per_category_with_its_last_full_month_against_its_average(self):
        page = self.render(self.PANELS)
        assert [[t.get_text() for t in chart.texts] for chart in page.axes[:-1]] == [
            ['Rent', 'Oct: $900, about its $900 average'],
            ['Groceries', 'Oct: $400, 14% above its $350 average'],
            ['Medical', 'Oct: $0, 100% below its $44 average'],
            ['Other', 'Oct: $25, 25% above its $20 average', 'Gifts, Pets'],
        ]

    def test_each_chart_has_a_bar_per_month_the_partial_month_lighter_and_its_average_dashed(self):
        groceries = self.render(self.PANELS).axes[1]
        assert [t.get_text() for t in groceries.get_xticklabels()] == ['Sep\n2026', 'Oct', 'Nov']   # narrow: year below
        assert [(p.get_height(), to_hex(p.get_facecolor()), round(p.get_facecolor()[3], 2))
                for p in groceries.patches] == [
            (300.0, '#2a78d6', 1.0), (400.0, '#2a78d6', 1.0), (100.0, '#2a78d6', 0.35)]
        (average,) = [line for line in groceries.lines if line.get_label() == 'Monthly average']
        assert (list(average.get_ydata()), average.get_linestyle()) == ([350.0, 350.0], '--')

    def test_a_heading_a_note_and_the_numbers_as_a_table(self):
        page = self.render(self.PANELS)
        assert [t.get_text() for t in page.texts] == [
            'Spending by category', '2026-09-01 to 2026-11-12',
            'Per month, each on its own scale; the dashed line is its monthly average, '
            'and a month only partly in the period is lighter.',
        ]
        assert _table_cells(page.axes[-1]) == [
            ['Category', 'Total', 'Monthly average', 'Last full month (Oct 2026)', 'Transactions'],
            ['Rent', '$2,700.00', '$900.00', '$900.00', '3'],
            ['Groceries', '$800.00', '$350.00', '$400.00', '3'],
            ['Medical', '$87.00', '$43.50', '$0.00', '1'],
            ['Other', '$40.00', '$20.00', '$25.00', '2'],
        ]

    def test_without_a_full_month_the_label_and_the_table_say_so(self):
        page = self.render([_panel('Rent', [0, 0, 90000], None, None, 1)])
        assert page.axes[0].texts[1].get_text() == 'No full month yet'
        assert _table_cells(page.axes[-1]) == [
            ['Category', 'Total', 'Monthly average', 'Last full month', 'Transactions'],
            ['Rent', '$900.00', '—', '—', '1'],
        ]

    def test_long_names_are_shortened(self):
        page = self.render([
            _panel('C' * 50, [100, 100, 100], 100, 100, 3),
            _panel('Other', [100, 100, 100], 100, 100, 12, others=[f'Category {i}' for i in range(12)]),
        ])
        category, others = page.axes[0].texts[0].get_text(), page.axes[1].texts[2].get_text()
        assert (len(category), category[-1]) == (pdf_pages.PANEL_CATEGORY_CHARS, '…')
        assert (len(others), others[-1]) == (pdf_pages.OTHERS_CHARS, '…')
        assert _table_cells(page.axes[-1])[1][0] == category

    def test_no_spending_says_so(self):
        page = self.render([])
        assert [t.get_text() for t in page.texts][-1] == 'No spending in this period.'
        assert page.axes == []


class TestNetPerMonthPages:
    """Net per month as the app's Insights Overview draws it: bars around $0, the average, a table."""

    ROWS = [   # summary_data.monthly_net's: three full months, then this month so far
        {'month': '2025-12', 'income': 300000, 'expenses': 120000, 'net': 180000, 'partial': False, 'average': None},
        {'month': '2026-01', 'income': 100000, 'expenses': 150050, 'net': -50050, 'partial': False, 'average': None},
        {'month': '2026-02', 'income': 80000, 'expenses': 50000, 'net': 30000, 'partial': False, 'average': 53317},
        {'month': '2026-03', 'income': 0, 'expenses': 2500, 'net': -2500, 'partial': True, 'average': None},
    ]

    def render(self, rows):
        pages = _Pages()
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter('always')
            pdf_pages.render_net_per_month_pages(pages, rows, '2025-12-01 to 2026-03-12')
        assert [str(w.message) for w in caught if issubclass(w.category, UserWarning)] == []
        return pages.figures

    def test_a_bar_per_month_around_0_coloured_by_sign_the_partial_month_lighter(self):
        (page,) = self.render(self.ROWS)
        chart = page.axes[0]
        assert [t.get_text() for t in chart.get_xticklabels()] == ['Dec 2025', 'Jan 2026', 'Feb', 'Mar']
        assert [(p.get_height(), to_hex(p.get_facecolor()), round(p.get_facecolor()[3], 2))
                for p in chart.patches] == [
            (1800.0, '#1baf7a', 1.0), (-500.5, '#eb6834', 1.0), (300.0, '#1baf7a', 1.0), (-25.0, '#eb6834', 0.35),
        ]

    def test_the_3_month_average_is_a_line_with_gaps_where_there_is_none(self):
        chart = self.render(self.ROWS)[0].axes[0]
        (line,) = [line for line in chart.lines if line.get_label() == '3-month average of full months']
        assert [None if math.isnan(y) else y for y in line.get_ydata()] == [None, None, 533.17, None]

    def test_a_heading_a_note_and_a_legend(self):
        (page,) = self.render(self.ROWS)
        assert [t.get_text() for t in page.texts] == [
            'Net per month', '2025-12-01 to 2026-03-12',
            'Money in minus money out each month, transfers left out; a month only partly in the period is lighter.',
        ]
        assert [t.get_text() for t in page.axes[0].get_legend().get_texts()] == [
            'More in than out', 'More out than in', '3-month average of full months']

    def test_the_numbers_as_a_table_under_the_chart(self):
        (page,) = self.render(self.ROWS)
        assert _table_cells(page.axes[1]) == [
            ['Month', 'Money in', 'Money out', 'Net', '3-month average'],
            ['Dec 2025', '$3,000.00', '$1,200.00', '+$1,800.00', '—'],
            ['Jan 2026', '$1,000.00', '$1,500.50', '-$500.50', '—'],
            ['Feb 2026', '$800.00', '$500.00', '+$300.00', '+$533.17'],
            ['Mar 2026 (partial)', '$0.00', '$25.00', '-$25.00', '—'],
        ]

    def test_a_long_run_labels_its_first_month_januaries_and_julys_and_continues_the_table(self):
        months = [f'{2024 + i // 12}-{i % 12 + 1:02d}' for i in range(pdf_pages.FIRST_PAGE_ROWS + 1)]
        rows = [{'month': m, 'income': 0, 'expenses': 0, 'net': 0, 'partial': False, 'average': None} for m in months]
        first, second = self.render(rows)
        assert [t.get_text() for t in first.axes[0].get_xticklabels()] == ['Jan 2024', 'Jul', 'Jan 2025', 'Jul']
        assert second.texts[0].get_text() == 'Net per month (continued)'
        assert _table_cells(second.axes[0])[1:] == [['Sep 2025', '$0.00', '$0.00', '$0.00', '—']]


class TestAccountPageLayout:
    """The pure pieces of an account's pages: how rows split into pages, and the table's cells."""

    F, C = pdf_pages.FIRST_PAGE_ROWS, pdf_pages.CONTINUED_ROWS

    @pytest.mark.parametrize('count, sizes', [
        (1, [1]), (F, [F]), (F + 1, [F, 1]), (F + C, [F, C]), (F + C + 1, [F, C, 1]),
    ])
    def test_rows_split_into_pages(self, count, sizes):
        assert [len(chunk) for chunk in pdf_pages.page_chunks(list(range(count)))] == sizes

    def test_table_rows(self):
        grocer = SimpleNamespace(id=1, date=date(2026, 1, 5), vendor='Grocer', category='Groceries', amount_cents=-4210)
        pay = SimpleNamespace(id=2, date=date(2026, 1, 15), vendor='Paycheck', category='Income', amount_cents=123456)
        rows = [LedgerRow(grocer, -4210), LedgerRow(pay, 119246)]
        assert pdf_pages.account_table_rows(rows, {1}) == [
            (['2026-01-05', 'Grocer', 'Groceries', '-$42.10', '-$42.10', 'Over'], True),
            (['2026-01-15', 'Paycheck', 'Income', '$1,234.56', '$1,192.46', ''], False),
        ]

    def test_long_text_is_shortened(self):
        t = SimpleNamespace(id=1, date=date(2026, 1, 5), vendor='V' * 80, category='C' * 50, amount_cents=-1)
        (cells, _), = pdf_pages.account_table_rows([LedgerRow(t, -1)], set())
        assert (len(cells[1]), cells[1][-1]) == (pdf_pages.VENDOR_CHARS, '…')
        assert (len(cells[2]), cells[2][-1]) == (pdf_pages.CATEGORY_CHARS, '…')


class TestSelection:
    """What goes into an export: every transaction of the chosen accounts in the period, by date."""

    @BOTH
    def test_nothing_in_the_period_is_400(self, client, auth_headers, ledger, url):
        resp = client.get(f'{url}?start_date=2026-03-01', headers=auth_headers)
        assert (resp.status_code, resp.json) == NOTHING

    @BOTH
    def test_no_transactions_at_all_is_400(self, client, auth_headers, account, url):
        resp = client.get(url, headers=auth_headers)
        assert (resp.status_code, resp.json) == NOTHING

    @BOTH
    def test_chosen_accounts_without_activity_are_400(self, client, auth_headers, ledger, savings, url):
        resp = client.get(f'{url}?account_ids={savings.id}&start_date=2026-02-01', headers=auth_headers)
        assert (resp.status_code, resp.json) == NOTHING

    def test_accounts_without_activity_are_left_out(self, client, auth_headers, ledger, account, savings):
        resp = client.get(f'{CSV_URL}?account_ids={account.id},{savings.id}&start_date=2026-02-01',
                          headers=auth_headers)
        assert resp.status_code == 200
        assert _column(resp, 'Bank Account') == ['Test Checking', 'Test Checking']

    def test_same_day_by_account_then_entry_order(self, client, auth_headers, account, savings):
        assert account.id < savings.id
        add = account_svc.add_transaction
        add(savings.id, date(2026, 3, 1), 'B', 'Misc', -1.0)
        add(account.id, date(2026, 3, 1), 'A1', 'Misc', -1.0)
        add(account.id, date(2026, 2, 28), 'Earlier', 'Misc', -1.0)
        add(account.id, date(2026, 3, 1), 'A2', 'Misc', -1.0)
        resp = client.get(CSV_URL, headers=auth_headers)
        assert _column(resp, 'Vendor') == ['Earlier', 'A1', 'A2', 'B']

    def test_categories_are_ignored(self, client, auth_headers, ledger, reported):
        assert len(_csv_rows(client.get(f'{CSV_URL}?categories=Income', headers=auth_headers))) == 5
        client.get(f'{PDF_URL}?categories=Income', headers=auth_headers)
        assert reported == [['Grocer', 'Interest', 'To savings', 'Refund']]

    @BOTH
    def test_another_users_account_is_400(self, client, auth_headers, ledger, url):
        other = User(username='other', email='other@example.com')
        other.set_password('otherpass')
        _db.session.add(other)
        _db.session.flush()
        theirs = AccountModel(user_id=other.id, acct_id_str='x', acct_name='Theirs')
        _db.session.add(theirs)
        _db.session.commit()
        account_svc.add_transaction(theirs.id, date(2026, 1, 10), 'Secret', 'Misc', -5.0)

        resp = client.get(f'{url}?account_ids={theirs.id}', headers=auth_headers)
        assert (resp.status_code, resp.json) == (400, {'success': False, 'error': f'Unknown account: {theirs.id}'})
        assert 'Secret' not in client.get(CSV_URL, headers=auth_headers).get_data(as_text=True)


class TestBadFilters:
    @BOTH
    @pytest.mark.parametrize('query, error', [
        ('account_ids=abc', 'account_ids must be a comma-separated list of account ids.'),
        ('start_date=not-a-date', 'start_date must be a date like 2026-01-31.'),
        ('end_date=2026-13-01', 'end_date must be a date like 2026-01-31.'),
        ('start_date=2026-03-01&end_date=2026-02-01', 'The start date must be on or before the end date.'),
    ], ids=['account-ids', 'start-date', 'end-date', 'start-after-end'])
    def test_bad_filters_are_400(self, client, auth_headers, account, url, query, error):
        resp = client.get(f'{url}?{query}', headers=auth_headers)
        assert (resp.status_code, resp.json) == (400, {'success': False, 'error': error})
