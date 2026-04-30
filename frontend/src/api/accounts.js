import { fetchAPI } from './client';

export const getAccounts = () =>
  fetchAPI('/api/accounts').then(d => d.accounts);

export const createAccount = (accountId, accountName) =>
  fetchAPI('/api/accounts', {
    method: 'POST',
    body: JSON.stringify({ account_id: accountId, account_name: accountName }),
  }).then(d => d.account);

export const updateAccount = (id, fields) =>
  fetchAPI(`/api/accounts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  }).then(d => d.account);

export const deleteAccount = (id) =>
  fetchAPI(`/api/accounts/${id}`, { method: 'DELETE' });

export const getUpcoming = (accountId, days = 30) =>
  fetchAPI(`/api/accounts/${accountId}/upcoming?days=${days}`).then(d => d.upcoming);
