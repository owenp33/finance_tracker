import { useState } from 'react';
import GoalRow from './GoalRow';
import AddGoalForm from './AddGoalForm';
import { formatCents } from '../../utils/money';

// The Goals section on Budgeting (Phase F, F2b): goals in order, each with its progress, status,
// monthly amount (its own, or the room) and when it's reached, a loan goal with its payoff chart
// (F2g); adding, editing, reordering and deleting them. `goalPlan` is hooks/useGoalPlan's (the Budgeting page shares it with the saving
// line); `accounts` (GET /api/accounts) fill the add form.
function GoalsSection({ accounts = [], goalPlan }) {
  const { goals, plans, room, payoffs, addGoal, editGoal, removeGoal, reorder } = goalPlan;
  const [adding, setAdding] = useState(false);

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
        {!adding && <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>+ Add goal</button>}
      </div>
      <p className="chart-note">
        Goals run in order; the next starts once one is reached.
      </p>
      <p className="goals-room">
        {room > 0
          ? `Room each month: ${formatCents(room)} (income - bills - spending, next 90 days)`
          : 'Room each month: none (spending meets or exceeds income)'}
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
              key={goal.id} goal={goal} plan={plans[i]} payoff={payoffs[i]} before={goals[i - 1]?.account_name}
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
