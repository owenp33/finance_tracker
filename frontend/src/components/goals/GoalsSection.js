import { useState } from 'react';
import GoalRow from './GoalRow';
import AddGoalForm from './AddGoalForm';
import { useGoals } from '../../hooks/useGoals';
import { useProjection } from '../../hooks/useProjection';
import { FORECAST_DAYS } from '../../utils/forecast';
import { monthlyRoom, goalPlan } from '../../utils/goals';
import { todayISO } from '../../utils/dates';
import { formatCents } from '../../utils/money';

// A stable stand-in when no one listens for errors (the hooks refetch when it changes)
const IGNORE_ERROR = () => {};

// The Goals section on Budgeting (Phase F, F2b): goals in order, each with its progress, status,
// monthly amount (its own, or the room: utils/goals.js) and when it's reached; adding, editing,
// reordering and deleting them. `accounts` (GET /api/accounts) give names and loans' rates, and
// `recurring` (every template) loans' regular payments; the room comes from the next 90 days'
// projection and `transactions`.
function GoalsSection({ accounts = [], transactions = [], recurring = [], onError = IGNORE_ERROR }) {
  const { goals, addGoal, editGoal, removeGoal, reorder } = useGoals(onError, accounts);
  const occurrences = useProjection(FORECAST_DAYS, onError);
  const [adding, setAdding] = useState(false);

  const today = todayISO();
  const room = monthlyRoom(transactions, recurring, occurrences, accounts.map(a => a.id), today);
  const plans = goals ? goalPlan(goals, { roomCents: room, accounts, recurring, today }) : [];

  const move = (index, step) => {
    const ids = goals.map(g => g.id);
    [ids[index], ids[index + step]] = [ids[index + step], ids[index]];
    reorder(ids);
  };

  const remove = (goal) => {
    if (window.confirm(`Delete the goal for ${goal.account_name}?`)) removeGoal(goal.id);
  };

  return (
    <section className="goals-section">
      <div className="goals-header">
        <h3>Goals</h3>
        {!adding && <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>+ Add goal</button>}
      </div>
      <p className="chart-note">
        Goals run in order: the first one not reached gets the monthly amount, and the next takes over once it's reached.
      </p>
      <p className="goals-room">
        {room > 0
          ? `Room each month: ${formatCents(room)} (scheduled income less scheduled bills and average spending, over the next 90 days)`
          : 'Room each month: none (spending is at or above scheduled income over the next 90 days)'}
      </p>
      {adding && (
        <AddGoalForm
          accounts={accounts}
          onAdd={async (fields) => { const added = await addGoal(fields); if (added) setAdding(false); return added; }}
          onCancel={() => setAdding(false)}
        />
      )}
      {goals === null ? (
        <p className="no-data">Loading goals…</p>
      ) : goals.length === 0 ? (
        <p className="no-data">No goals yet. Add one: a balance to reach on an account, like savings to $7,500 or a loan paid off.</p>
      ) : (
        <ol className="goal-list">
          {goals.map((goal, i) => (
            <GoalRow
              key={goal.id} goal={goal} plan={plans[i]} before={goals[i - 1]?.account_name}
              isFirst={i === 0} isLast={i === goals.length - 1}
              onEdit={editGoal} onMove={(step) => move(i, step)} onDelete={() => remove(goal)}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

export default GoalsSection;
