import { useState, useMemo } from 'react';
import BudgetRow from './BudgetRow';
import AddBudgetForm from './AddBudgetForm';
import ViewAsTable from './ViewAsTable';
import { sortList } from './transactions/utils';
import {
  useBudgetData,
  getPrevPeriod,
  getNextPeriod,
  formatPeriod,
} from '../hooks/useBudgetData';
import { useMonthProjection } from '../hooks/useProjection';
import { todayISO, monthEndLabel } from '../utils/dates';
import { formatCents } from '../utils/money';
import { rowPace, percentUsed, paceLabel } from '../utils/budgetPace';

const getCurrentPeriod = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

// The rows' paces as a table. `monthEnd` ("Oct 31", the current month only) adds the expected
// spend, the bills still due, and where the month ends at this rate (paced by recurring: with the
// bills still due).
const paceTableColumns = (monthEnd) => [
  'Category', 'Spent', 'Budget', 'Used',
  ...(monthEnd ? ['Expected by today', 'Bills still due', `At this rate, by ${monthEnd}`] : []),
  'Status',
];

const paceTableRow = (item, pace, monthEnd) => {
  const used = percentUsed(pace);
  const atMonthEnd = formatCents(pace.projected) + (pace.basis === 'scheduled' ? ' with bills due' : '');
  return [
    item.category, formatCents(pace.spent), formatCents(pace.effective), used === null ? '—' : `${used}%`,
    ...(monthEnd ? [formatCents(pace.expected), formatCents(pace.due), atMonthEnd] : []),
    paceLabel(pace),
  ];
};

function BudgetingView({ transactions, onBudgetChange }) {
  const [period, setPeriod] = useState(getCurrentPeriod);
  const [showAddForm, setShowAddForm] = useState(false);

  const [monthlyIncome, setMonthlyIncome] = useState(() => {
    const saved = localStorage.getItem('budget_monthly_income');
    return saved ? parseFloat(saved) : 0;
  });
  const [isEditingIncome, setIsEditingIncome] = useState(false);
  const [incomeInput, setIncomeInput] = useState('');

  const {
    progress,
    loading,
    error,
    saveErrors,
    setError,
    handleAmountBlur,
    handleRolloverToggle,
    handlePaceToggle,
    handleDelete,
    handleAdd,
  } = useBudgetData(period, onBudgetChange);

  // The recurring charges still to come this month, for paces by recurring and bills still due
  const today = todayISO();
  const occurrences = useMonthProjection(today, setError);

  // ── Derived values ─────────────────────────────────────────────────────────

  const totalAllocated = progress.reduce((sum, item) => sum + item.allocated, 0);
  const totalSpent = progress.reduce((sum, item) => sum + item.spent, 0);
  const unallocated = monthlyIncome - totalAllocated;
  const incomeSet = monthlyIncome > 0;

  // Each row's pace, worked out as the Dashboard does (rowPace); this month's also says where the
  // month ends
  const monthEnd = period === today.slice(0, 7) ? monthEndLabel(period) : null;
  const paces = progress.map(item => rowPace(item, { period, today, transactions, occurrences }));

  const budgetedCategories = new Set(progress.map(p => p.category));
  const suggestedCategories = [
    ...new Set(transactions.map(t => t.category).filter(Boolean)),
  ].filter(c => !budgetedCategories.has(c));

  // Pre-filter transactions by period and group by category (ISP: BudgetRow only gets what it needs)
  const txsByCategory = useMemo(() => {
    const map = {};
    transactions.forEach(t => {
      if (!t.date.startsWith(period)) return;
      if (!map[t.category]) map[t.category] = [];
      map[t.category].push(t);
    });
    // Newest first, reimbursements included, as in the transaction lists
    Object.keys(map).forEach(category => { map[category] = sortList(map[category], 'date-desc'); });
    return map;
  }, [transactions, period]);

  // ── Income helpers ─────────────────────────────────────────────────────────

  const openIncomeEdit = () => {
    setIncomeInput(incomeSet ? monthlyIncome.toFixed(2) : '');
    setIsEditingIncome(true);
  };

  const saveIncome = () => {
    const parsed = parseFloat(incomeInput);
    if (!isNaN(parsed) && parsed >= 0) {
      setMonthlyIncome(parsed);
      localStorage.setItem('budget_monthly_income', String(parsed));
    }
    setIsEditingIncome(false);
  };

  const handleIncomeKeyDown = (e) => {
    if (e.key === 'Enter') saveIncome();
    if (e.key === 'Escape') setIsEditingIncome(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="budgeting-view">

      <div className="period-nav">
        <button className="btn btn-ghost" onClick={() => setPeriod(p => getPrevPeriod(p))}>←</button>
        <span className="period-label">{formatPeriod(period)}</span>
        <button className="btn btn-ghost" onClick={() => setPeriod(p => getNextPeriod(p))}>→</button>
      </div>

      <div className="budget-summary-cards">
        <div className="budget-summary-card income-card" onClick={!isEditingIncome ? openIncomeEdit : undefined}>
          <div className="budget-summary-label">Monthly Income</div>
          {isEditingIncome ? (
            <input
              className="income-inline-input"
              type="number"
              step="0.01"
              min="0"
              value={incomeInput}
              placeholder="0.00"
              autoFocus
              onChange={e => setIncomeInput(e.target.value)}
              onBlur={saveIncome}
              onKeyDown={handleIncomeKeyDown}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <div className="budget-summary-value">${monthlyIncome.toFixed(2)}</div>
          )}
          {!incomeSet && !isEditingIncome && (
            <div className="income-hint">Click to set your income</div>
          )}
        </div>

        <div className={`budget-summary-card${!incomeSet ? ' muted' : ''}`}>
          <div className="budget-summary-label">Allocated</div>
          <div className="budget-summary-value">${totalAllocated.toFixed(2)}</div>
          {incomeSet && (
            <div className="budget-summary-sub">
              {((totalAllocated / monthlyIncome) * 100).toFixed(0)}% of income
            </div>
          )}
        </div>

        <div className={`budget-summary-card${progress.length === 0 ? ' muted' : ''}`}>
          <div className="budget-summary-label">Total Spent</div>
          <div className={`budget-summary-value${totalSpent > totalAllocated ? ' red' : ''}`}>
            ${totalSpent.toFixed(2)}
          </div>
          {totalAllocated > 0 && (
            <div className="budget-summary-sub">
              {((totalSpent / totalAllocated) * 100).toFixed(0)}% of allocated
            </div>
          )}
        </div>

        <div className={`budget-summary-card${!incomeSet ? ' muted' : ''}`}>
          <div className="budget-summary-label">Unallocated</div>
          <div className={`budget-summary-value${incomeSet ? (unallocated >= 0 ? ' green' : ' red') : ''}`}>
            ${Math.abs(unallocated).toFixed(2)}{incomeSet && unallocated < 0 && ' over'}
          </div>
          {incomeSet && <div className="budget-summary-sub">remaining to allocate</div>}
        </div>
      </div>

      {error && (
        <div className="error-message">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <div className="category-allocations-card">
        <div className="category-allocations-header">
          <h3>Category Allocations</h3>
          {!showAddForm && (
            <button className="btn btn-secondary btn-sm" onClick={() => setShowAddForm(true)}>
              + Add Category
            </button>
          )}
        </div>

        {showAddForm && (
          <AddBudgetForm
            suggestedCategories={suggestedCategories}
            onAdd={async (fields) => {
              await handleAdd(fields);
              setShowAddForm(false);
            }}
            onCancel={() => setShowAddForm(false)}
          />
        )}

        {loading ? (
          <p className="no-data">Loading…</p>
        ) : progress.length === 0 ? (
          <p className="no-data">No budgets set for this period. Add a category above.</p>
        ) : (
          <>
            <div className="budget-rows">
              {progress.map((item, i) => (
                <BudgetRow
                  key={item.id}
                  item={item}
                  pace={paces[i]}
                  monthEnd={monthEnd}
                  onAmountBlur={handleAmountBlur}
                  onRolloverToggle={handleRolloverToggle}
                  onPaceToggle={handlePaceToggle}
                  onDelete={handleDelete}
                  hasSaveError={saveErrors.has(item.id)}
                  monthlyIncome={monthlyIncome}
                  categoryTransactions={txsByCategory[item.category] || []}
                />
              ))}
            </div>
            <ViewAsTable
              caption={`Budget pace, ${formatPeriod(period)}`}
              columns={paceTableColumns(monthEnd)}
              rows={progress.map((item, i) => paceTableRow(item, paces[i], monthEnd))}
            />
          </>
        )}
      </div>

    </div>
  );
}

export default BudgetingView;
