"""
csv_export.py - The transactions CSV download
"""
import csv
import io

COLUMNS = ['date', 'vendor', 'category', 'amount', 'account', 'notes', 'is_transfer', 'is_reimbursement']


def transactions_csv(transactions):
    """The transactions, in the order given, as CSV text with a header row."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(COLUMNS)
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
    return buf.getvalue()
