import { uploadFile, fetchAPI } from './client';

// unmatched: what to do with rows whose account isn't found — 'create' | 'account' | 'skip'.
// targetAccountId is the account those rows go into when unmatched is 'account'.
export const previewImport = (file, { unmatched = 'create', targetAccountId = null } = {}) => {
  const extraFields = { unmatched };
  if (unmatched === 'account' && targetAccountId) extraFields.target_account_id = targetAccountId;
  return uploadFile('/api/import/preview', file, extraFields);
};

export const confirmImport = (transactions) =>
  fetchAPI('/api/import/confirm', {
    method: 'POST',
    body: JSON.stringify({ transactions }),
  });
