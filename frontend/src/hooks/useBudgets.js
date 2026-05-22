import { useState, useCallback } from 'react';
import { getBudgetProgress } from '../api/budgets';

export function useBudgets({ setError }) {
  const [budgetData, setBudgetData] = useState([]);

  const loadBudgetProgress = useCallback(async (period) => {
    try {
      const data = await getBudgetProgress(period);
      setBudgetData(data);
    } catch (err) {
      setError(err.message);
    }
  }, [setError]);

  return { budgetData, loadBudgetProgress };
}
