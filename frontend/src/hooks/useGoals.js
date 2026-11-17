import { useState, useEffect, useCallback } from 'react';
import { getGoals, createGoal, updateGoal, deleteGoal, reorderGoals } from '../api/goals';

// The user's goals (GET /api/goals), null while loading, [] after a failure; loaded again whenever
// `accounts` changes (the goals' status comes from the balances) and after every change. Each change
// resolves to whether it worked, so a form can stay open after an error; errors go to onError.
export function useGoals(onError, accounts) {
  const [goals, setGoals] = useState(null);

  const load = useCallback(async () => {
    try {
      setGoals(await getGoals());
    } catch (err) {
      setGoals(current => current ?? []);
      onError(err.message);
    }
  }, [onError]);

  useEffect(() => { load(); }, [load, accounts]);

  const run = async (change) => {
    try {
      await change();
      await load();
      return true;
    } catch (err) {
      onError(err.message);
      return false;
    }
  };

  return {
    goals,
    addGoal: (fields) => run(() => createGoal(fields)),
    editGoal: (id, fields) => run(() => updateGoal(id, fields)),
    removeGoal: (id) => run(() => deleteGoal(id)),
    reorder: (goalIds) => run(() => reorderGoals(goalIds)),
  };
}
