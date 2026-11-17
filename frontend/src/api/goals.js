import { fetchAPI } from './client';

// The user's goals in order, each with its account's balance and status (GET /api/goals)
export const getGoals = () => fetchAPI('/api/goals').then(d => d.goals);

// fields: account_id, target (dollars) and monthly (dollars, or null for the app's suggestion)
export const createGoal = (fields) =>
  fetchAPI('/api/goals', { method: 'POST', body: JSON.stringify(fields) }).then(d => d.goal);

// fields: target and/or monthly (null goes back to the app's suggestion)
export const updateGoal = (id, fields) =>
  fetchAPI(`/api/goals/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }).then(d => d.goal);

export const deleteGoal = (id) => fetchAPI(`/api/goals/${id}`, { method: 'DELETE' });

// Every goal's id, in the new order
export const reorderGoals = (goalIds) =>
  fetchAPI('/api/goals/order', { method: 'PUT', body: JSON.stringify({ goal_ids: goalIds }) }).then(d => d.goals);
