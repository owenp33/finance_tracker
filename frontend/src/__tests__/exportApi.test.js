import { exportTransactionsCSV, exportReportPDF } from '../api/export';
import { downloadFile } from '../api/client';

jest.mock('../api/client');

test('a download sends the chosen accounts and period', () => {
  exportTransactionsCSV({ accountIds: [1, 2], startDate: '2026-01-01', endDate: '2026-01-31' });
  expect(downloadFile).toHaveBeenCalledWith(
    '/api/export/transactions.csv?account_ids=1%2C2&start_date=2026-01-01&end_date=2026-01-31', 'transactions.csv',
  );
});

test('without filters there is no query string', () => {
  exportReportPDF({});
  expect(downloadFile).toHaveBeenLastCalledWith('/api/export/report.pdf', 'report.pdf');
});

test('categories are never sent', () => {
  exportReportPDF({ categories: ['Groceries'] });
  expect(downloadFile).toHaveBeenLastCalledWith('/api/export/report.pdf', 'report.pdf');
});
