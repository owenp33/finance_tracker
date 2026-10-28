"""
Export tests: what an export covers, the CSV download, and the PDF report.
"""
import csv
import io
import re
from datetime import date
from types import SimpleNamespace

import pytest

from extensions import db as _db
from models.account import AccountModel
from models.user import User
from services.account_service import AccountService
from services.analytics_service import AnalyticsService
from services.balance_service import LedgerRow
from services.budget_service import BudgetService
from services.reports import pdf_pages

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
        assert resp.headers['Content-Disposition'] == 'attachment; filename=transactions.csv'
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

    def test_six_summary_pages_then_a_page_per_account(self, client, auth_headers, ledger):
        resp = client.get(PDF_URL, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.mimetype == 'application/pdf'
        assert resp.headers['Content-Disposition'] == 'attachment; filename=report.pdf'
        assert resp.data.startswith(b'%PDF')
        assert _pdf_pages(resp) == 6 + 2

    def test_a_long_account_continues_on_more_pages(self, client, auth_headers, account):
        for day in range(1, pdf_pages.FIRST_PAGE_ROWS + 2):
            account_svc.add_transaction(account.id, date(2026, 1, day), f'Shop {day}', 'Misc', -1.0)
        assert _pdf_pages(client.get(PDF_URL, headers=auth_headers)) == 6 + 2

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


class TestAccountPageLayout:
    """The pure pieces of an account's pages: how rows split into pages, and the table's cells."""

    F, C = pdf_pages.FIRST_PAGE_ROWS, pdf_pages.CONTINUED_ROWS

    @pytest.mark.parametrize('count, sizes', [
        (1, [1]), (F, [F]), (F + 1, [F, 1]), (F + C, [F, C]), (F + C + 1, [F, C, 1]),
    ])
    def test_rows_split_into_pages(self, count, sizes):
        assert [len(chunk) for chunk in pdf_pages.account_page_chunks(list(range(count)))] == sizes

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
