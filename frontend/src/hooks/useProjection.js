import { useState, useEffect } from 'react';
import { getProjection } from '../api/recurring';

// The recurring occurrences still to come, from today through `days` days ahead (GET
// /api/recurring/projection), fetched again only when `days` changes. A failure goes to setError.
export function useProjection(days, setError) {
  const [occurrences, setOccurrences] = useState([]);

  useEffect(() => {
    let current = true;
    getProjection(days)
      .then(list => { if (current) setOccurrences(list); })
      .catch(err => { if (current) setError(err.message); });
    return () => { current = false; };
  }, [days, setError]);

  return occurrences;
}
