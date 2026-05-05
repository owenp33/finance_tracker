import { fetchAPI } from './client';

export const getAnalytics = (accountId) =>
  fetchAPI(`/api/analytics/${accountId}`);
