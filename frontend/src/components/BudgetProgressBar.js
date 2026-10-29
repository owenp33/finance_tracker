import { useCategoryColors } from '../CategoryColorContext';

function BudgetProgressBar({ item, showCategory = true, compact = false }) {
  const { getColor } = useCategoryColors();
  const { category, allocated, carried_over, spent, remaining, over_budget } = item;
  const total = allocated + (carried_over || 0);
  const pct = total > 0 ? Math.min((spent / total) * 100, 100) : 0;
  const displayPct = total > 0 ? Math.round((spent / total) * 100) : 0;
  const color = getColor(category);

  if (compact) {
    return (
      <div className="bri-progress">
        <div className="bri-bar-track">
          <div
            className={`bri-bar-fill${over_budget ? ' over' : ''}`}
            style={{ width: `${pct}%`, ...(!over_budget && { background: color }) }}
          />
        </div>
        <div className="bri-bar-meta">
          <span className={over_budget ? 'over' : ''}>
            {over_budget
              ? `$${Math.abs(remaining).toFixed(2)} over budget`
              : `$${remaining.toFixed(2)} remaining`}
          </span>
          <span className={over_budget ? 'over' : ''}>
            ${spent.toFixed(2)} / ${total.toFixed(2)} · {displayPct}%
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="budget-progress-item">
      <div className="budget-progress-header">
        {showCategory && <span className="budget-category">{category}</span>}
        <span className={`budget-amounts${over_budget ? ' red' : ''}`}>
          ${spent.toFixed(2)} / ${total.toFixed(2)}
        </span>
      </div>
      <div className="budget-bar-track">
        <div
          className={`budget-bar-fill${over_budget ? ' over-budget' : ''}`}
          style={{ width: `${pct}%`, ...(!over_budget && { background: color }) }}
        />
      </div>
      {over_budget && (
        <span className="budget-over-label">
          ${Math.abs(remaining).toFixed(2)} over budget
        </span>
      )}
    </div>
  );
}

export default BudgetProgressBar;
