import { useState, useCallback, useEffect } from 'react';
import BudgetRow from './BudgetRow';
import {
  getBudgetProgress,
  getBudgets,
  createBudget,
  updateBudget,
  deleteBudget,
} from '../api/budgets';

// ── Period helpers ────────────────────────────────────────────────────────────

const getCurrentPeriod = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const getPrevPeriod = (period) => {
  const [year, month] = period.split('-').map(Number);
  return month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, '0')}`;
};

const getNextPeriod = (period) => {
  const [year, month] = period.split('-').map(Number);
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, '0')}`;
};

const formatPeriod = (period) => {
  const [year, month] = period.split('-').map(Number);
  return new Date(year, month - 1).toLocaleString('default', {
    month: 'long',
    year: 'numeric',
  });
};

// ── Component ─────────────────────────────────────────────────────────────────

function BudgetingView({ transactions, onBudgetChange }) {
  const [period, setPeriod] = useState(getCurrentPeriod);
  const [progress, setProgress] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Map of budget id → true for rows whose last auto-save failed
  const [saveErrors, setSaveErrors] = useState(new Map());

  // Add-category form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [adding, setAdding] = useState(false);

  // ── Derived: category suggestions ──────────────────────────────────────────
  // Unique categories from all transactions, minus any already budgeted this period
  const budgetedCategories = new Set(progress.map(p => p.category));
  const suggestedCategories = [
    ...new Set(transactions.map(t => t.category).filter(Boolean)),
  ].filter(c => !budgetedCategories.has(c));

  // ── Data loading ───────────────────────────────────────────────────────────

  const loadProgress = useCallback(async (p) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getBudgetProgress(p);

      // Auto-rollover: if this period is empty, walk back up to 12 months to
      // find the nearest non-empty period and copy its rollover=true rows.
      if (data.length === 0) {
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
          if (toRollover.length > 0) {
            await Promise.all(
              toRollover.map(b =>
                createBudget({ category: b.category, period: p, amount: b.amount, rollover: true })
              )
            );
            const fresh = await getBudgetProgress(p);
            setProgress(fresh);
            onBudgetChange?.();
            return;
          }
        } catch {
          // Rollover failed — user can add categories manually
        }
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

  // ── Propagate an amount change to all existing future budget rows ───────────

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

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleAmountBlur = async (item, newAmount) => {
    // Clear any previous save error for this row
    setSaveErrors(prev => {
      const next = new Map(prev);
      next.delete(item.id);
      return next;
    });

    let applyToFuture = false;
    if (item.rollover) {
      applyToFuture = window.confirm(
        `Apply $${newAmount.toFixed(2)} to all existing future months for "${item.category}" as well?\n\nOK = all future months  ·  Cancel = this month only`
      );
    }

    try {
      await updateBudget(item.id, { amount: newAmount });
      if (applyToFuture) {
        await propagateToFuture(item.category, newAmount, period);
      }
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
    if (
      !window.confirm(
        `Remove "${item.category}" budget? This will clear over-budget flags on existing transactions.`
      )
    ) return;
    try {
      await deleteBudget(item.id);
      await loadProgress(period);
      onBudgetChange?.();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAdd = async () => {
    if (!newCategory.trim() || !newAmount) return;
    setAdding(true);
    try {
      await createBudget({
        category: newCategory.trim(),
        period,
        amount: parseFloat(newAmount),
      });
      setShowAddForm(false);
      setNewCategory('');
      setNewAmount('');
      await loadProgress(period);
      onBudgetChange?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const cancelAdd = () => {
    setShowAddForm(false);
    setNewCategory('');
    setNewAmount('');
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="budgeting-view">

      {/* Period navigation */}
      <div className="period-nav">
        <button className="btn btn-ghost" onClick={() => setPeriod(p => getPrevPeriod(p))}>
          ←
        </button>
        <span className="period-label">{formatPeriod(period)}</span>
        <button className="btn btn-ghost" onClick={() => setPeriod(p => getNextPeriod(p))}>
          →
        </button>
      </div>

      {error && (
        <div className="error-message">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* Budget rows */}
      {loading ? (
        <p className="no-data">Loading…</p>
      ) : progress.length === 0 ? (
        <p className="no-data">No budgets set for this period. Add a category below.</p>
      ) : (
        <div className="budget-rows">
          {progress.map(item => (
            <BudgetRow
              key={item.id}
              item={item}
              onAmountBlur={handleAmountBlur}
              onRolloverToggle={handleRolloverToggle}
              onDelete={handleDelete}
              hasSaveError={saveErrors.has(item.id)}
            />
          ))}
        </div>
      )}

      {/* Add category */}
      {!showAddForm ? (
        <button className="btn btn-secondary" onClick={() => setShowAddForm(true)}>
          + Add Category
        </button>
      ) : (
        <div className="add-budget-form">
          <div className="form-group">
            <label>Category</label>
            <input
              list="budget-category-suggestions"
              type="text"
              value={newCategory}
              onChange={e => setNewCategory(e.target.value)}
              placeholder="e.g. Groceries"
              autoFocus
            />
            {/* Native datalist gives free-text + suggestions in one element */}
            <datalist id="budget-category-suggestions">
              {suggestedCategories.map(c => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="form-group">
            <label>Monthly Allocation ($)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={newAmount}
              onChange={e => setNewAmount(e.target.value)}
              placeholder="0.00"
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <div className="form-actions">
            <button
              className="btn btn-primary"
              onClick={handleAdd}
              disabled={adding || !newCategory.trim() || !newAmount}
            >
              {adding ? 'Adding…' : 'Add'}
            </button>
            <button className="btn btn-ghost" onClick={cancelAdd}>
              Cancel
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

export default BudgetingView;
