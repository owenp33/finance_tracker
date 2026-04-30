import { useState, useCallback } from 'react';
import { getAnalytics } from '../api/analytics';

export function useAnalytics({ setError }) {
  const [analytics, setAnalytics] = useState(null);

  const loadAnalytics = useCallback(async (accountId) => {
    if (!accountId) return;
    try {
      const data = await getAnalytics(accountId);
      setAnalytics(data);
    } catch (err) {
      setError(err.message);
    }
  }, [setError]);

  return { analytics, loadAnalytics };
}
