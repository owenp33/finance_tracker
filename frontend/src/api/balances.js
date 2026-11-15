import { fetchAPI } from './client';

// Every account's balances over all time: the starting balance, each date's end-of-day balance,
// and the current balance (GET /api/balances)
export const getBalances = () => fetchAPI('/api/balances').then(d => d.balances);
