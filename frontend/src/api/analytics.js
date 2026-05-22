import { fetchAPI } from './client';

export const getAnalytics = () =>
  fetchAPI('/api/analytics/all');
