import { useCategoryColors } from '../CategoryColorContext';

function BudgetProgressBar({ item, showCategory = true }) {
  const { getColor } = useCategoryColors();
  const { category, allocated, carried_over, spent, remaining, over_budget } = item;
  const total = allocated + (carried_over || 0);
  const pct = total > 0 ? Math.min((spent / total) * 100, 100) : 0;

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
          style={{ width: `${pct}%`, ...(!over_budget && { background: getColor(category) }) }}
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
