import { useState, useEffect } from 'react';
import { getCategoryColor } from '../categoryColors';

function BudgetRow({ item, onAmountBlur, onRolloverToggle, onDelete, hasSaveError, monthlyIncome }) {
  const [localAmount, setLocalAmount] = useState(item.allocated.toFixed(2));

  useEffect(() => {
    setLocalAmount(item.allocated.toFixed(2));
  }, [item.allocated]);

  const handleBlur = () => {
    const parsed = parseFloat(localAmount);
    if (isNaN(parsed) || parsed < 0) {
      setLocalAmount(item.allocated.toFixed(2));
      return;
    }
    if (parsed === item.allocated) return;
    onAmountBlur(item, parsed);
  };

  const pct = monthlyIncome > 0
    ? ((item.allocated / monthlyIncome) * 100).toFixed(0)
    : null;

  return (
    <div className={`budget-row-inline${hasSaveError ? ' has-error' : ''}`}>
      <span className="bri-dot" style={{ background: getCategoryColor(item.category) }} />
      <span className="bri-category">{item.category}</span>

      <div className="bri-amount-wrap">
        <span className="bri-prefix">$</span>
        <input
          type="number"
          step="0.01"
          min="0"
          className="bri-amount-input"
          value={localAmount}
          onChange={e => setLocalAmount(e.target.value)}
          onBlur={handleBlur}
          aria-label={`Monthly allocation for ${item.category}`}
        />
      </div>

      {pct !== null && <span className="bri-pct">{pct}%</span>}

      {hasSaveError && <span className="bri-error">Save failed</span>}

      <label className="bri-rollover">
        <input
          type="checkbox"
          checked={item.rollover}
          onChange={() => onRolloverToggle(item)}
        />
        Rollover
      </label>

      <button
        className="btn btn-danger btn-sm bri-delete"
        onClick={() => onDelete(item)}
        aria-label={`Remove ${item.category} budget`}
      >
        ✕
      </button>
    </div>
  );
}

export default BudgetRow;
