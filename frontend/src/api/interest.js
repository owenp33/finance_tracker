import { fetchAPI } from './client';

// The user's interest hits, approved or waiting for approval (`approved`), newest first: each a
// record of its own, not a transaction, on the 1st of its period (GET /api/interest)
export const getInterest = () => fetchAPI('/api/interest').then(d => d.interest);

// Changes a hit waiting for approval to the bank's figure: `amount` in dollars, 0 or more (charged
// on a loan, paid on any other account)
export const updateInterest = (id, amount) =>
  fetchAPI(`/api/interest/${id}`, { method: 'PATCH', body: JSON.stringify({ amount }) }).then(d => d.interest);

// Approves a hit waiting for approval: it moves its account's balance
export const approveInterest = (id) => fetchAPI(`/api/interest/${id}/approve`, { method: 'POST' }).then(d => d.interest);

// Deletes a hit waiting for approval (it won't be booked again)
export const deleteInterest = (id) => fetchAPI(`/api/interest/${id}`, { method: 'DELETE' });
