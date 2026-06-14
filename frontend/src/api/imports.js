import { uploadFile, fetchAPI } from './client';

export const previewImport = (file, accountId) => {
  const extraFields = accountId ? { account_id: accountId } : {};
  return uploadFile('/api/import/preview', file, extraFields);
};

export const confirmImport = (transactions) =>
  fetchAPI('/api/import/confirm', {
    method: 'POST',
    body: JSON.stringify({ transactions }),
  });
