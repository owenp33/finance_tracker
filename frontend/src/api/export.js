const API_BASE = process.env.REACT_APP_API_URL || '';

const downloadBlob = async (endpoint, defaultFilename) => {
  const token = localStorage.getItem('token');

  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Export failed');
  }

  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/);
  const filename = match ? match[1] : defaultFilename;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const buildQuery = ({ accountIds, startDate, endDate, categories } = {}) => {
  const params = new URLSearchParams();
  if (accountIds?.length)  params.set('account_ids', accountIds.join(','));
  if (startDate)           params.set('start_date', startDate);
  if (endDate)             params.set('end_date', endDate);
  if (categories?.length)  params.set('categories', categories.join(','));
  return params.toString();
};

export const exportTransactionsCSV = (filters) =>
  downloadBlob(`/api/export/transactions.csv?${buildQuery(filters)}`, 'transactions.csv');

export const exportReportPDF = (filters) =>
  downloadBlob(`/api/export/report.pdf?${buildQuery(filters)}`, 'report.pdf');
