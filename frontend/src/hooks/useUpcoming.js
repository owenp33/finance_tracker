import { useState, useCallback } from 'react';
import { getUpcoming } from '../api/accounts';

export function useUpcoming({ setError }) {
  const [upcoming, setUpcoming] = useState([]);

  const loadUpcoming = useCallback(async (accounts, days = 7) => {
    if (!accounts || accounts.length === 0) {
      setUpcoming([]);
      return;
    }
    try {
      const results = await Promise.all(
        accounts.map(a => getUpcoming(a.id, days))
      );
      const flat = results
        .flat()
        .sort((a, b) => a.next_date.localeCompare(b.next_date));
      setUpcoming(flat);
    } catch (err) {
      setError(err.message);
    }
  }, [setError]);

  return { upcoming, loadUpcoming };
}
