"""
Export tests: the CSV download and the PDF report. These pin today's behavior so the export code
can move out of the route safely; Phase 3 changes the formats on purpose, one step at a time.
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

    def test_categories_are_ignored(self, client, auth_headers, ledger):
        resp = client.get(f'{CSV_URL}?categories=Income', headers=auth_headers)
        assert len(_csv_rows(resp)) == 5

    def test_only_the_users_own_transactions(self, client, auth_headers, ledger):
        other = User(username='other', email='other@example.com')
        other.set_password('otherpass')
        _db.session.add(other)
        _db.session.flush()
        theirs = AccountModel(user_id=other.id, acct_id_str='x', acct_name='Theirs')
        _db.session.add(theirs)
        _db.session.commit()
        account_svc.add_transaction(theirs.id, date(2026, 1, 10), 'Secret', 'Misc', -5.0)
        resp = client.get(f'{CSV_URL}?account_ids={theirs.id}', headers=auth_headers)
        assert _csv_rows(resp) == [_csv_rows(client.get(CSV_URL, headers=auth_headers))[0]]

    def test_no_transactions_is_just_the_header(self, client, auth_headers, account):
        assert len(_csv_rows(client.get(CSV_URL, headers=auth_headers))) == 1


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

    def test_still_six_pages_without_transactions(self, client, auth_headers, account):
        assert _pdf_pages(client.get(PDF_URL, headers=auth_headers)) == 6

    def test_filters_choose_what_the_report_covers(self, client, auth_headers, ledger, account, monkeypatch):
        seen = []
        real = AnalyticsService.generate_report
        monkeypatch.setattr(AnalyticsService, 'generate_report',
                            staticmethod(lambda txs: seen.append([t.vendor for t in txs]) or real(txs)))
        client.get(f'{PDF_URL}?account_ids={account.id}&categories=Groceries', headers=auth_headers)
        assert seen == [['Grocer', 'Refund']]


class TestBadFilters:
    @pytest.mark.parametrize('url', [CSV_URL, PDF_URL], ids=['csv', 'pdf'])
    @pytest.mark.parametrize('query, error', [
        ('account_ids=abc', 'account_ids must be a comma-separated list of account ids.'),
        ('start_date=not-a-date', 'start_date must be a date like 2026-01-31.'),
        ('end_date=2026-13-01', 'end_date must be a date like 2026-01-31.'),
        ('start_date=2026-03-01&end_date=2026-02-01', 'The start date must be on or before the end date.'),
    ], ids=['account-ids', 'start-date', 'end-date', 'start-after-end'])
    def test_bad_filters_are_400(self, client, auth_headers, account, url, query, error):
        resp = client.get(f'{url}?{query}', headers=auth_headers)
        assert (resp.status_code, resp.json) == (400, {'success': False, 'error': error})
