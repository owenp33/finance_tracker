import { useState, useEffect } from 'react';
import BudgetProgressBar from './BudgetProgressBar';

function BudgetRow({ item, onAmountBlur, onRolloverToggle, onDelete, hasSaveError }) {
  const [localAmount, setLocalAmount] = useState(item.allocated.toFixed(2));

  // Sync displayed value if the server response changes the allocation
  // (e.g. after a successful save or external reload)
  useEffect(() => {
    setLocalAmount(item.allocated.toFixed(2));
  }, [item.allocated]);

  const handleBlur = () => {
    const parsed = parseFloat(localAmount);
    if (isNaN(parsed) || parsed < 0) {
      setLocalAmount(item.allocated.toFixed(2)); // reset to last known good value
      return;
    }
    if (parsed === item.allocated) return; // no change, skip network call
    onAmountBlur(item, parsed);
  };

  return (
    <div className="budget-row">
      <div className="budget-row-header">
        <span className="budget-row-category">{item.category}</span>
        <div className="budget-row-meta">
          <label className="rollover-label">
            <input
              type="checkbox"
              checked={item.rollover}
              onChange={() => onRolloverToggle(item)}
            />
            Rollover
          </label>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => onDelete(item)}
            aria-label={`Remove ${item.category} budget`}
          >
            ✕
          </button>
        </div>
      </div>

      <div className="budget-amount-row">
        <span className="budget-amount-prefix">$</span>
        <input
          type="number"
          step="0.01"
          min="0"
          className={`budget-amount-input${hasSaveError ? ' error' : ''}`}
          value={localAmount}
          onChange={e => setLocalAmount(e.target.value)}
          onBlur={handleBlur}
          aria-label={`Monthly allocation for ${item.category}`}
        />
        <span className="budget-amount-suffix">/ month</span>
        {hasSaveError && (
          <span className="budget-save-error">Save failed — try again</span>
        )}
      </div>

      <BudgetProgressBar item={item} showCategory={false} />
    </div>
  );
}

export default BudgetRow;
