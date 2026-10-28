"""
csv_export.py - The transactions CSV download

One row per transaction with its account's running balance. Income and expense sit in their own
columns as positive amounts, so the file reads well in a spreadsheet and imports again: the
importer reads "Bank Account" as the account and ignores "Running balance".
"""
import csv
import io

COLUMNS = ['Bank Account', 'Date', 'Vendor', 'Category', 'Notes', 'Income', 'Expense', 'Running balance']


def _dollars(cents):
    return f'{cents / 100:.2f}'


def ledger_csv(rows):
    """LedgerRows, in the order given, as CSV text with a header row (a zero amount is income)."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(COLUMNS)
    for row in rows:
        t = row.transaction
        writer.writerow([
            t.account.acct_name,
            t.date.isoformat(),
            t.vendor,
            t.category,
            t.notes or '',
            _dollars(t.amount_cents) if t.amount_cents >= 0 else '',
            _dollars(-t.amount_cents) if t.amount_cents < 0 else '',
            _dollars(row.balance_cents),
        ])
    return buf.getvalue()
