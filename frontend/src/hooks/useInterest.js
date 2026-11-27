import { useState, useCallback } from 'react';
import { getInterest } from '../api/interest';

// The user's interest hits (GET /api/interest), newest first; [] until they load
export function useInterest({ setError }) {
  const [interest, setInterest] = useState([]);

  const loadInterest = useCallback(async () => {
    try {
      setInterest(await getInterest());
    } catch (err) {
      setError(err.message);
    }
  }, [setError]);

  return { interest, loadInterest };
}
