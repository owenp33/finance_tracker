import { uploadFile, fetchAPI } from './client';

export const previewCSV = (file, accountId) => {
  const extraFields = accountId ? { account_id: accountId } : {};
  return uploadFile('/api/csv/preview', file, extraFields);
};

export const confirmImport = (transactions) =>
  fetchAPI('/api/csv/confirm', {
    method: 'POST',
    body: JSON.stringify({ transactions }),
  });
