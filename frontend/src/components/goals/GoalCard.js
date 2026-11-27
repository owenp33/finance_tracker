import { formatCents, formatWholeDollars } from '../../utils/money';
import { monthRangeLabel } from '../../utils/dates';
import { formatDate } from '../transactions/utils';

// What to do this month for a goal's plan: leave money in a savings-like account, pay a loan extra
const thisMonthText = (goal, plan) => {
  if (plan.monthlyCents <= 0) return 'Nothing goes toward it this month';
  return goal.account_kind === 'loan'
    ? `Pay ${formatCents(plan.monthlyCents)} extra this month`
    : `Leave ${formatCents(plan.monthlyCents)} in ${goal.account_name} this month`;
};

const reachText = (goal, plan) => {
  if (plan.months === null) return 'not reached at this pace';
  const paidOff = goal.account_kind === 'loan' && goal.target_cents === 0;
  return `${paidOff ? 'paid off' : 'reached'} by ${monthRangeLabel(plan.reachMonth, plan.reachMonth)}`;
};

// The Dashboard's goal card (Phase F, F2d), pushing for this month's action: the active goal
// (`active`: utils/goals.js activeSaving) with where it stands, what to leave or pay this month and
// when it's reached; or that every goal is reached, or that there are none yet (`goals`: null while
// loading). The link goes to the Goals section on Budgeting. `dips` (utils/goals.js goalDips) are
// the reached goals the forecast falls under, each an orange warning, whichever goal is active.
function GoalCard({ goals, active, onNavigate, dips = [] }) {
  let title = 'Goals';
  let value = '—';
  let sub = 'Loading goals…';
  if (goals && goals.length === 0) {
    sub = 'No goals yet';
  } else if (goals && !active) {
    value = 'All reached';
    sub = 'Every goal is reached and held';
  } else if (active) {
    const { goal, plan } = active;
    title = `${goal.account_name} goal`;
    value = goal.account_kind === 'loan'
      ? `${formatWholeDollars(Math.max(-goal.balance_cents, 0) / 100)} owed`
      : `${formatWholeDollars(goal.balance_cents / 100)} of ${formatWholeDollars(goal.target_cents / 100)}`;
    sub = `${thisMonthText(goal, plan)} · ${reachText(goal, plan)}`;
  }
  return (
    <div className="stat-card goal-card">
      <div className="section-header">
        <h3>{title}</h3>
        {goals && (
          <button className="link-btn" onClick={() => onNavigate('budgeting')}>
            {goals.length === 0 ? 'Set a goal →' : 'Goals →'}
          </button>
        )}
      </div>
      <div className="value">{value}</div>
      <div className="stat-sub">{sub}</div>
      {dips.map(({ goal, dipsOn }) => (
        <div key={goal.id} className="goal-card-warning">
          {`${goal.account_name}: forecast dips under ${formatWholeDollars(goal.target_cents / 100)} on ${formatDate(dipsOn)}`}
        </div>
      ))}
    </div>
  );
}

export default GoalCard;
