import { useState, useCallback } from 'react';
import { getAllTransactions } from '../api/transactions';

export function useTransactions({ setError }) {
  const [transactions, setTransactions] = useState([]);

  const loadTransactions = useCallback(async () => {
    try {
      const data = await getAllTransactions();
      setTransactions(data);
    } catch (err) {
      setError(err.message);
    }
  }, [setError]);

  return { transactions, loadTransactions };
}
