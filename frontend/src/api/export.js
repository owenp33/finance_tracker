import { downloadFile } from './client';

// The export filters as a query string; exports have no category filter
const withQuery = (path, { accountIds, startDate, endDate } = {}) => {
  const params = new URLSearchParams();
  if (accountIds?.length)  params.set('account_ids', accountIds.join(','));
  if (startDate)           params.set('start_date', startDate);
  if (endDate)             params.set('end_date', endDate);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
};

export const exportTransactionsCSV = (filters) =>
  downloadFile(withQuery('/api/export/transactions.csv', filters), 'transactions.csv');

export const exportReportPDF = (filters) =>
  downloadFile(withQuery('/api/export/report.pdf', filters), 'report.pdf');
