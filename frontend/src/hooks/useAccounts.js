import { useState, useCallback } from 'react';
import { getAccounts } from '../api/accounts';

export function useAccounts({ setError }) {
  const [accounts, setAccounts] = useState([]);

  const loadAccounts = useCallback(async () => {
    try {
      const data = await getAccounts();
      setAccounts(data);
    } catch (err) {
      setError(err.message);
    }
  }, [setError]);

  return { accounts, loadAccounts };
}
