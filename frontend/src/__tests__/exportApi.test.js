import { exportTransactionsCSV, exportReportPDF } from '../api/export';

beforeEach(() => {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true, blob: async () => new Blob(['x']), headers: { get: () => null },
  });
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  URL.createObjectURL = jest.fn(() => 'blob:export');
  URL.revokeObjectURL = jest.fn();
});
afterEach(() => jest.restoreAllMocks());

const requested = () => new URL(fetch.mock.calls[0][0], 'http://localhost');

test('a download sends the chosen accounts and period', async () => {
  await exportTransactionsCSV({ accountIds: [1, 2], startDate: '2026-01-01', endDate: '2026-01-31' });
  expect(requested().pathname).toBe('/api/export/transactions.csv');
  expect(Object.fromEntries(requested().searchParams)).toEqual({
    account_ids: '1,2', start_date: '2026-01-01', end_date: '2026-01-31',
  });
});

test('categories are never sent', async () => {
  await exportReportPDF({ categories: ['Groceries'] });
  expect(requested().pathname).toBe('/api/export/report.pdf');
  expect(requested().search).toBe('');
});

test("a refused export throws the server's message", async () => {
  fetch.mockResolvedValue({ ok: false, json: async () => ({ success: false, error: 'No transactions in this period.' }) });
  await expect(exportReportPDF({})).rejects.toThrow('No transactions in this period.');
});
