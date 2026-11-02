import { useState, useId } from 'react';
import { useCategoryColors } from '../CategoryColorContext';
import { formatCents } from '../utils/money';
import { paceLabel } from '../utils/budgetPace';

// Where `part` falls along a bar of `whole`, as a percent (capped at the bar's end)
const position = (part, whole) => (whole > 0 ? Math.min(part / whole, 1) * 100 : 0);

// A budget row's pace (utils/budgetPace.js budgetPace): the share of the budget spent, a marker
// where the expected spend sits by now, and the status in words. Hovering, focusing or tapping the
// bar shows the numbers behind it; `current` (this month) adds the pace (even or scheduled) and the
// expected and projected amounts.
function BudgetPace({ category, pace, current }) {
  const [showDetails, setShowDetails] = useState(false);
  const detailsId = useId();
  const { getColor } = useCategoryColors();
  const color = getColor(category);
  const over = pace.status === 'over';
  const spentOfBudget = `${formatCents(pace.spent)} of ${formatCents(pace.effective)}`;
  const label = paceLabel(pace);

  return (
    <div className="budget-pace">
      <div
        className="budget-pace-chart"
        onMouseEnter={() => setShowDetails(true)}
        onMouseLeave={() => setShowDetails(false)}
      >
        <div
          className="budget-pace-bar"
          role="img"
          tabIndex={0}
          aria-label={`${category}: ${spentOfBudget}, ${label}`}
          aria-describedby={showDetails ? detailsId : undefined}
          onFocus={() => setShowDetails(true)}
          onBlur={() => setShowDetails(false)}
          onClick={() => setShowDetails(true)}
          onKeyDown={e => { if (e.key === 'Escape') setShowDetails(false); }}
        >
          <div className="budget-pace-track" style={{ background: color }}>
            <div
              className={`budget-pace-fill${over ? ' over' : ''}`}
              style={{ width: `${over ? 100 : position(pace.spent, pace.effective)}%`, ...(!over && { background: color }) }}
            />
          </div>
          <div className="budget-pace-marker" style={{ left: `${position(pace.expected, pace.effective)}%` }} />
        </div>

        {showDetails && (
          <div className="budget-pace-details" role="tooltip" id={detailsId}>
            <dl>
              <dt>Spent</dt><dd>{formatCents(pace.spent)}</dd>
              <dt>Budget</dt><dd>{formatCents(pace.effective)}</dd>
              {pace.carriedOver !== 0 && (
                <><dt>Includes carried over</dt><dd>{formatCents(pace.carriedOver)}</dd></>
              )}
              {current && (
                <>
                  <dt>Pace</dt><dd>{pace.basis === 'scheduled' ? 'Scheduled' : 'Even'}</dd>
                  <dt>Expected by today</dt><dd>{formatCents(pace.expected)}</dd>
                  <dt>Projected month end</dt><dd>{formatCents(pace.projected)}</dd>
                </>
              )}
            </dl>
          </div>
        )}
      </div>

      <div className="budget-pace-meta">
        <span>{spentOfBudget}</span>
        <span className={`budget-pace-status ${pace.status}`}>{label}</span>
      </div>
    </div>
  );
}

export default BudgetPace;
