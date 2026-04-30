import { fetchAPI } from './client';

export const getBudgetProgress = (period) => {
  const query = period ? `?period=${period}` : '';
  return fetchAPI(`/api/budgets/progress${query}`).then(d => d.progress);
};

export const getBudgets = (period) => {
  const query = period ? `?period=${period}` : '';
  return fetchAPI(`/api/budgets${query}`).then(d => d.budgets);
};

export const createBudget = (body) =>
  fetchAPI('/api/budgets', {
    method: 'POST',
    body: JSON.stringify(body),
  }).then(d => d.budget);

export const updateBudget = (id, body) =>
  fetchAPI(`/api/budgets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }).then(d => d.budget);

export const deleteBudget = (id) =>
  fetchAPI(`/api/budgets/${id}`, { method: 'DELETE' });
