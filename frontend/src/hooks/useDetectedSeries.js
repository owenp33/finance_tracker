import { useState, useEffect, useCallback } from 'react';
import { getDetectedSeries } from '../api/recurring';

// Recurring series found among the user's transactions (null until loaded). reload() looks
// again, e.g. after one is added or marked "Not recurring".
export function useDetectedSeries() {
  const [series, setSeries] = useState(null);
  const [error, setError] = useState(null);
  const [requests, setRequests] = useState(0);

  useEffect(() => {
    let current = true;   // ignore a response that arrives after a newer request
    getDetectedSeries()
      .then(found => { if (current) { setSeries(found); setError(null); } })
      .catch(err => { if (current) setError(err.message); });
    return () => { current = false; };
  }, [requests]);

  const reload = useCallback(() => setRequests(n => n + 1), []);

  return { series, error, reload };
}
