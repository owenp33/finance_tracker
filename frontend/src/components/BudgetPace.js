import { useState, useId } from 'react';
import { useCategoryColors } from '../CategoryColorContext';
import { formatCents } from '../utils/money';
import { paceLabel } from '../utils/budgetPace';

// Where `part` falls along a bar of `whole`, as a percent (capped at the bar's end)
const position = (part, whole) => (whole > 0 ? Math.min(part / whole, 1) * 100 : 0);

// A budget row's pace (utils/budgetPace.js budgetPace): the share of the budget spent, the bills
// still due as stripes after it (orange when they'd go over), a marker where the expected spend
// sits by now, and the status in words. Hovering, focusing or tapping the
// bar shows the numbers behind it. `monthEnd` ("Oct 31"), given for the current month only, adds
// the pace, the expected spend and where the month ends: at this rate, or paced by recurring, with
// the bills still due.
function BudgetPace({ category, pace, monthEnd }) {
  const [showDetails, setShowDetails] = useState(false);
  const detailsId = useId();
  const { getColor } = useCategoryColors();
  const color = getColor(category);
  const over = pace.status === 'over';
  const byRecurring = pace.basis === 'scheduled';
  const dueOver = pace.overAfterDue > 0;
  const fill = over ? 100 : position(pace.spent, pace.effective);
  const dueEnd = over ? 100 : position(pace.spent + pace.due, pace.effective);
  const spentOfBudget = `${formatCents(pace.spent)} of ${formatCents(pace.effective)}`;
  const dueNote = pace.due > 0 ? `, ${formatCents(pace.due)} in bills still due` : '';
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
          aria-label={`${category}: ${spentOfBudget}${dueNote}, ${label}`}
          aria-describedby={showDetails ? detailsId : undefined}
          onFocus={() => setShowDetails(true)}
          onBlur={() => setShowDetails(false)}
          onClick={() => setShowDetails(true)}
          onKeyDown={e => { if (e.key === 'Escape') setShowDetails(false); }}
        >
          <div className="budget-pace-track" style={{ background: color }}>
            <div
              className={`budget-pace-fill${over ? ' over' : ''}`}
              style={{ width: `${fill}%`, ...(!over && { background: color }) }}
            />
            {dueEnd > fill && (
              <div
                className={`budget-pace-due${dueOver ? ' over' : ''}`}
                style={{ left: `${fill}%`, width: `${dueEnd - fill}%`, ...(!dueOver && { color }) }}
              />
            )}
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
              {monthEnd && (
                <>
                  <dt>Pace</dt><dd>{byRecurring ? 'By recurring' : 'Even'}</dd>
                  <dt>Expected by today</dt><dd>{formatCents(pace.expected)}</dd>
                  {pace.due > 0 && <><dt>Bills still due</dt><dd>{formatCents(pace.due)}</dd></>}
                  <dt>{byRecurring ? 'With bills still due' : 'At this rate'}</dt>
                  <dd>{formatCents(pace.projected)} by {monthEnd}</dd>
                </>
              )}
            </dl>
          </div>
        )}
      </div>

      <div className="budget-pace-meta">
        <span>
          {spentOfBudget}
          {pace.due > 0 && (
            <span className={`budget-pace-due-note${dueOver ? ' over' : ''}`}>
              {` + ${formatCents(pace.due)} due${dueOver ? ` (over by ${formatCents(pace.overAfterDue)})` : ''}`}
            </span>
          )}
        </span>
        <span className={`budget-pace-status ${pace.status}`}>{label}</span>
      </div>
    </div>
  );
}

export default BudgetPace;
