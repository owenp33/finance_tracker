import { fetchAPI } from './client';

export const getAccounts = () =>
  fetchAPI('/api/accounts').then(d => d.accounts);

// fields: account_id, account_name, kind ('bank' or 'loan') and, for a loan, apr (percent or null)
export const createAccount = (fields) =>
  fetchAPI('/api/accounts', {
    method: 'POST',
    body: JSON.stringify(fields),
  }).then(d => d.account);

export const updateAccount = (id, fields) =>
  fetchAPI(`/api/accounts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  }).then(d => d.account);

export const deleteAccount = (id) =>
  fetchAPI(`/api/accounts/${id}`, { method: 'DELETE' });
