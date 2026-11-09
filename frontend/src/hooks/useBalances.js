import { useState, useEffect } from 'react';
import { getBalances } from '../api/balances';

// Every account's balances over all time (GET /api/balances), fetched once: null until they
// arrive, and an empty list after a failure, which goes to setError
export function useBalances(setError) {
  const [balances, setBalances] = useState(null);

  useEffect(() => {
    let current = true;
    getBalances()
      .then(list => { if (current) setBalances(list); })
      .catch(err => {
        if (!current) return;
        setBalances([]);
        setError(err.message);
      });
    return () => { current = false; };
  }, [setError]);

  return balances;
}
