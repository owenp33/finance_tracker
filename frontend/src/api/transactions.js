import { fetchAPI } from './client';

export const getAllTransactions = () =>
  fetchAPI('/api/accounts/all-transactions').then(d => d.transactions);

export const getAccountTransactions = (accountId, params = {}) => {
  const query = new URLSearchParams(params).toString();
  const url = `/api/accounts/${accountId}/transactions${query ? `?${query}` : ''}`;
  return fetchAPI(url).then(d => d.transactions);
};

export const getTransaction = (id) =>
  fetchAPI(`/api/transactions/${id}`).then(d => d.transaction);

export const addTransaction = (accountId, body) =>
  fetchAPI(`/api/accounts/${accountId}/transactions`, {
    method: 'POST',
    body: JSON.stringify(body),
  }).then(d => d.transaction);

export const updateTransaction = (id, body) =>
  fetchAPI(`/api/transactions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }).then(d => d.transaction);

export const deleteTransaction = (id) =>
  fetchAPI(`/api/transactions/${id}`, { method: 'DELETE' });

export const toggleTransfer = (id) =>
  fetchAPI(`/api/transactions/${id}/transfer`, { method: 'PATCH' }).then(d => d.transaction);

export const pairTransfer = (id, toAccountId) =>
  fetchAPI(`/api/transactions/${id}/transfer/pair`, {
    method: 'POST',
    body: JSON.stringify({ to_account_id: toAccountId }),
  }).then(d => ({ transaction: d.transaction, peer: d.peer }));

export const breakTransferLink = (id) =>
  fetchAPI(`/api/transactions/${id}/transfer/pair`, { method: 'DELETE' }).then(d => d.transaction);
