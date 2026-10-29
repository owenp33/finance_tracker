import { useState, useCallback, useEffect } from 'react';
import {
  getBudgetProgress,
  getBudgets,
  createBudget,
  updateBudget,
  deleteBudget,
} from '../api/budgets';

// ── Period utilities ──────────────────────────────────────────────────────────

export const getPrevPeriod = (period) => {
  const [year, month] = period.split('-').map(Number);
  return month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, '0')}`;
};

export const getNextPeriod = (period) => {
  const [year, month] = period.split('-').map(Number);
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, '0')}`;
};

export const formatPeriod = (period) => {
  const [year, month] = period.split('-').map(Number);
  return new Date(year, month - 1).toLocaleString('default', {
    month: 'long',
    year: 'numeric',
  });
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useBudgetData(period, onBudgetChange) {
  const [progress, setProgress] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saveErrors, setSaveErrors] = useState(new Map());

  const loadProgress = useCallback(async (p) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getBudgetProgress(p);

      // Auto-rollover: look back up to 12 months for rollover categories missing this period
      try {
        let searchPeriod = getPrevPeriod(p);
        let toRollover = [];
        for (let i = 0; i < 12; i++) {
          const prevBudgets = await getBudgets(searchPeriod);
          if (prevBudgets.length > 0) {
            toRollover = prevBudgets.filter(b => b.rollover);
            break;
          }
          searchPeriod = getPrevPeriod(searchPeriod);
        }
        const existing = new Set(data.map(b => b.category));
        const missing = toRollover.filter(b => !existing.has(b.category));
        if (missing.length > 0) {
          await Promise.all(
            missing.map(b =>
              createBudget({ category: b.category, period: p, amount: b.amount, rollover: true })
            )
          );
          const fresh = await getBudgetProgress(p);
          setProgress(fresh);
          onBudgetChange?.();
          return;
        }
      } catch {
        // Rollover failed silently — user can add categories manually
      }

      setProgress(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [onBudgetChange]);

  useEffect(() => {
    loadProgress(period);
  }, [period, loadProgress]);

  const propagateToFuture = async (category, amount, fromPeriod) => {
    const futurePeriods = [];
    let p = fromPeriod;
    for (let i = 0; i < 12; i++) {
      p = getNextPeriod(p);
      futurePeriods.push(p);
    }
    const results = await Promise.all(
      futurePeriods.map(fp => getBudgets(fp).catch(() => []))
    );
    const toUpdate = results.flat().filter(b => b.category === category);
    if (toUpdate.length > 0) {
      await Promise.all(toUpdate.map(b => updateBudget(b.id, { amount })));
    }
  };

  const handleAmountBlur = async (item, newAmount) => {
    setSaveErrors(prev => { const n = new Map(prev); n.delete(item.id); return n; });

    let applyToFuture = false;
    if (item.rollover) {
      applyToFuture = window.confirm(
        `Apply $${newAmount.toFixed(2)} to all existing future months for "${item.category}" as well?\n\nOK = all future months  ·  Cancel = this month only`
      );
    }

    try {
      await updateBudget(item.id, { amount: newAmount });
      if (applyToFuture) await propagateToFuture(item.category, newAmount, period);
      await loadProgress(period);
      onBudgetChange?.();
    } catch {
      setSaveErrors(prev => new Map(prev).set(item.id, true));
    }
  };

  const handleRolloverToggle = async (item) => {
    try {
      await updateBudget(item.id, { rollover: !item.rollover });
      await loadProgress(period);
      onBudgetChange?.();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(
      `Remove "${item.category}" budget? This will also delete all future rollover copies and clear over-budget flags on affected transactions.`
    )) return;
    try {
      await deleteBudget(item.id);
      await loadProgress(period);
      onBudgetChange?.();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAdd = async ({ category, amount }) => {
    await createBudget({ category, period, amount });
    await loadProgress(period);
    onBudgetChange?.();
  };

  return {
    progress,
    loading,
    error,
    saveErrors,
    setError,
    handleAmountBlur,
    handleRolloverToggle,
    handleDelete,
    handleAdd,
  };
}
