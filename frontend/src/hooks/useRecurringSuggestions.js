import { useState, useEffect } from 'react';
import { getSuggestions } from '../api/recurring';

// A template's suggestions (null until loaded). They're fetched again whenever the template's
// suggestion count changes, which every link, dismissal or delete does once the list reloads.
export function useRecurringSuggestions(recurringId, suggestionCount) {
  const [suggestions, setSuggestions] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let current = true;   // ignore a response that arrives after a newer request
    getSuggestions(recurringId)
      .then(found => { if (current) { setSuggestions(found); setError(null); } })
      .catch(err => { if (current) setError(err.message); });
    return () => { current = false; };
  }, [recurringId, suggestionCount]);

  return { suggestions, error };
}
