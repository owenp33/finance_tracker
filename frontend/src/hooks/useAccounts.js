import { useState, useCallback } from 'react';
import { getAccounts } from '../api/accounts';

export function useAccounts({ setError }) {
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);

  const loadAccounts = useCallback(async () => {
    try {
      const data = await getAccounts();
      setAccounts(data);
      setSelectedAccount(prev => (prev === null && data.length > 0 ? data[0].id : prev));
    } catch (err) {
      setError(err.message);
    }
  }, [setError]);

  return { accounts, selectedAccount, setSelectedAccount, loadAccounts };
}
