import { fetchAPI } from './client';

export const getAccountRecurring = (accountId) =>
  fetchAPI(`/api/accounts/${accountId}/recurring`).then(d => d.recurring);

export const getRecurring = (id) =>
  fetchAPI(`/api/recurring/${id}`).then(d => d.recurring);

export const addRecurring = (accountId, body) =>
  fetchAPI(`/api/accounts/${accountId}/recurring`, {
    method: 'POST',
    body: JSON.stringify(body),
  }).then(d => d.recurring);

export const updateRecurring = (id, body) =>
  fetchAPI(`/api/recurring/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }).then(d => d.recurring);

export const deleteRecurring = (id, deleteGenerated = false) =>
  fetchAPI(`/api/recurring/${id}?delete_generated=${deleteGenerated}`, { method: 'DELETE' });

// Series membership: transactions that may belong to a template, and linking or dismissing them
export const getSuggestions = (id) =>
  fetchAPI(`/api/recurring/${id}/suggestions`).then(d => d.suggestions);

export const linkToRecurring = (id, transactionId) =>
  fetchAPI(`/api/recurring/${id}/transactions/${transactionId}`, { method: 'POST' }).then(d => d.recurring);

export const unlinkFromRecurring = (id, transactionId) =>
  fetchAPI(`/api/recurring/${id}/transactions/${transactionId}`, { method: 'DELETE' }).then(d => d.recurring);

export const dismissSuggestion = (id, transactionId) =>
  fetchAPI(`/api/recurring/${id}/dismissals/${transactionId}`, { method: 'POST' }).then(d => d.recurring);
