import { fetchAPI } from './client';

// The user's interest hits, newest first: each a record of its own, not a transaction, on the 1st
// of its period (GET /api/interest)
export const getInterest = () => fetchAPI('/api/interest').then(d => d.interest);

// Changes a hit to the bank's figure: `amount` in dollars, 0 or more (charged on a loan, paid on
// any other account)
export const updateInterest = (id, amount) =>
  fetchAPI(`/api/interest/${id}`, { method: 'PATCH', body: JSON.stringify({ amount }) }).then(d => d.interest);
