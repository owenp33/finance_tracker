import { formatWholeDollars } from '../../utils/money';

// The status chip's class and text, as in the Goals section on Budgeting
const statusOf = (goal) => (goal.reached ? ['held', 'Reached'] : goal.active ? ['active', 'Active'] : ['waiting', 'Waiting']);

// The whole percent of a savings-like goal's target the balance holds, 0 to 100
const percentThere = (goal) => (goal.reached || goal.target_cents <= 0
  ? 100
  : Math.min(Math.floor((Math.max(goal.balance_cents, 0) * 100) / goal.target_cents), 100));

// How far along a goal is, in words: savings "Goal $7,500: 40% there, $4,500 to go", a loan at $0
// "Goal: paid off, $75,217 to go", a reached goal "Goal $7,500: reached"
const progressText = (goal) => {
  const paidOff = goal.account_kind === 'loan' && goal.target_cents === 0;
  const aim = paidOff ? 'Goal: paid off' : `Goal ${formatWholeDollars(goal.target_cents / 100)}:`;
  const left = formatWholeDollars(goal.remaining_cents / 100);
  if (goal.reached) return paidOff ? `${aim}, reached` : `${aim} reached`;
  if (goal.account_kind === 'loan') return `${aim}${paidOff ? ',' : ''} ${left} to go`;
  return `${aim} ${percentThere(goal)}% there, ${left} to go`;
};

// An account's goals on its row in Transactions → Accounts (Phase F, F2f): each one's progress and
// status, with a bar for a savings-like goal (a loan has no starting point to measure from)
function AccountGoalProgress({ goals }) {
  return goals.map(goal => {
    const [statusClass, statusText] = statusOf(goal);
    return (
      <div key={goal.id} className="account-goal">
        <div className="account-goal-heading">
          <small className="account-goal-text">{progressText(goal)}</small>
          <span className={`goal-status ${statusClass}`}>{statusText}</span>
        </div>
        {goal.account_kind !== 'loan' && (
          <div className="goal-bar" aria-hidden="true">
            <div className="goal-bar-fill" style={{ width: `${percentThere(goal)}%` }} />
          </div>
        )}
      </div>
    );
  });
}

export default AccountGoalProgress;
