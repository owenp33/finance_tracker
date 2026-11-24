import { formatCents } from '../../utils/money';

// The active goal's saving as a line beside this month's category budgets (Phase F, F2c): its
// monthly amount (its own or the suggestion; an extra payment for a loan, on top of its regular
// ones) and what's gone to it so far this month, its account's change since the 1st (`movedCents`).
function GoalSavingRow({ goal, plan, movedCents }) {
  const loan = goal.account_kind === 'loan';
  const amount = plan.monthlyCents > 0
    ? `${formatCents(plan.monthlyCents)}${loan ? ' extra' : ''} this month (${plan.own ? 'yours' : 'suggested'})`
    : 'nothing goes toward it this month';
  let soFar;
  if (loan) {
    soFar = movedCents >= 0 ? `${formatCents(movedCents)} paid down so far` : `${formatCents(-movedCents)} more owed so far`;
  } else {
    soFar = movedCents >= 0 ? `${formatCents(movedCents)} so far` : `${formatCents(-movedCents)} less so far`;
  }
  return (
    <p className="budget-goal-saving">{`Goal: ${goal.account_name} · ${amount} · ${soFar}`}</p>
  );
}

export default GoalSavingRow;
