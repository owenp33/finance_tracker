import { useState, useEffect } from 'react';
import { getProjection } from '../api/recurring';
import { daysInMonth } from '../utils/dates';

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

// This month's recurring occurrences still to come: from `today` (YYYY-MM-DD) through the month's
// last day, asking for at least one day, as the projection needs
export function useMonthProjection(today, setError) {
  return useProjection(Math.max(daysInMonth(today.slice(0, 7)) - Number(today.slice(8, 10)), 1), setError);
}
