"""
Export tests: what an export covers, the CSV download, and the PDF report.
"""
import csv
import io
import re
from datetime import date

import pytest

from extensions import db as _db
from models.account import AccountModel
from models.user import User
from services.account_service import AccountService
from services.analytics_service import AnalyticsService

account_svc = AccountService()

CSV_URL = '/api/export/transactions.csv'
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


def _pdf_pages(resp):
    return len(re.findall(rb'/Type\s*/Page[^s]', resp.data))


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

    def test_every_transaction_oldest_first(self, client, auth_headers, ledger):
        resp = client.get(CSV_URL, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.mimetype == 'text/csv'
        assert resp.headers['Content-Disposition'] == 'attachment; filename=transactions.csv'
        assert _csv_rows(resp) == [
            ['date', 'vendor', 'category', 'amount', 'account', 'notes', 'is_transfer', 'is_reimbursement'],
            ['2026-01-05', 'Grocer', 'Groceries', '-42.1', 'Test Checking', 'weekly', 'False', 'False'],
            ['2026-01-15', 'Interest', 'Income', '3.25', 'Savings', '', 'False', 'False'],
            ['2026-02-01', 'To savings', 'Transfer', '-100.0', 'Test Checking', '', 'True', 'False'],
            ['2026-02-20', 'Refund', 'Groceries', '10.0', 'Test Checking', '', 'False', 'True'],
        ]

    def test_accounts_and_dates_narrow_it(self, client, auth_headers, ledger, account):
        resp = client.get(f'{CSV_URL}?account_ids={account.id}&start_date=2026-01-06&end_date=2026-02-01',
                          headers=auth_headers)
        assert [row[1] for row in _csv_rows(resp)[1:]] == ['To savings']

    def test_an_empty_account_list_means_every_account(self, client, auth_headers, ledger):
        assert len(_csv_rows(client.get(f'{CSV_URL}?account_ids=,', headers=auth_headers))) == 5


class TestPdfReport:
    def test_requires_login(self, client):
        assert client.get(PDF_URL).status_code == 401

    def test_a_six_page_pdf(self, client, auth_headers, ledger):
        resp = client.get(PDF_URL, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.mimetype == 'application/pdf'
        assert resp.headers['Content-Disposition'] == 'attachment; filename=report.pdf'
        assert resp.data.startswith(b'%PDF')
        assert _pdf_pages(resp) == 6

    def test_accounts_and_dates_choose_what_it_covers(self, client, auth_headers, ledger, account, reported):
        client.get(f'{PDF_URL}?account_ids={account.id}&start_date=2026-01-06', headers=auth_headers)
        assert reported == [['To savings', 'Refund']]


NOTHING = (400, {'success': False, 'error': 'No transactions in this period.'})


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
        assert [row[4] for row in _csv_rows(resp)[1:]] == ['Test Checking', 'Test Checking']

    def test_same_day_by_account_then_entry_order(self, client, auth_headers, account, savings):
        assert account.id < savings.id
        add = account_svc.add_transaction
        add(savings.id, date(2026, 3, 1), 'B', 'Misc', -1.0)
        add(account.id, date(2026, 3, 1), 'A1', 'Misc', -1.0)
        add(account.id, date(2026, 2, 28), 'Earlier', 'Misc', -1.0)
        add(account.id, date(2026, 3, 1), 'A2', 'Misc', -1.0)
        resp = client.get(CSV_URL, headers=auth_headers)
        assert [row[1] for row in _csv_rows(resp)[1:]] == ['Earlier', 'A1', 'A2', 'B']

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
