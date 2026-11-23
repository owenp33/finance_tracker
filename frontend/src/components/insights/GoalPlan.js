import GoalPlanChart from './charts/GoalPlanChart';
import ViewAsTable from '../ViewAsTable';
import { formatCents, formatWholeDollars } from '../../utils/money';
import { monthRangeLabel, shiftPeriod } from '../../utils/dates';

const monthLabel = (month) => monthRangeLabel(month, month);
const whole = (cents) => formatWholeDollars(cents / 100);

// A loan whose goal is $0 owed is paid off; any other goal is reached
const reachedWord = (line) => (line.owed && line.target === 0 ? 'paid off' : 'reached');

// A reached goal, as Budgeting words it
const heldText = (goal) => `${goal.position}. ${goal.account_name} · Reached: ${goal.account_kind === 'loan' && goal.target_cents === 0
  ? 'paid off'
  : `keep it at ${formatCents(goal.target_cents)} or more`}`;

// Where a goal is headed, after its name: "$3,000 → $7,500 by Jan 2027 · $2,600.00 a month" / "$75,217
// owed → paid off by Aug 2029 · $2,600.00 extra a month from Feb 2027" (its turn starting later)
const headedText = (line, plan, thisMonth) => {
  const from = line.owed ? `${whole(line.path[0])} owed` : whole(line.goal.balance_cents);
  const to = line.owed ? (line.target === 0 ? 'paid off' : `${whole(line.target)} owed`) : whole(line.target);
  const parts = [plan.months === null ? `${from} → ${to}` : `${from} → ${to} by ${monthLabel(plan.reachMonth)}`];
  parts.push(plan.monthlyCents > 0 && plan.startsIn !== null
    ? `${formatCents(plan.monthlyCents)}${line.owed ? ' extra' : ''} a month`
      + `${plan.startsIn > 0 ? ` from ${monthLabel(shiftPeriod(thisMonth, plan.startsIn + 1))}` : ''}`
    : 'Nothing goes toward it');
  if (plan.months === null) parts.push('not reached at this pace');
  return parts.join(' · ');
};

// Insights → Accounts' goal plan (Phase F): the goals' plan as on Budgeting, over time. A reached goal
// is a line of text; each other goal a small chart (GoalPlanChart) on one shared month axis, from now
// until the last goal is reached, titled with where it's headed; each hand-off in words and as a
// dashed line on every chart; then the months as a table. `plans` are utils/goals.js goalPlan's and
// `timeline` its goalTimeline's; `goals` null while they load (nothing shown).
function GoalPlan({ goals, plans, timeline }) {
  if (goals === null || timeline === null) return null;
  const byId = Object.fromEntries(timeline.goals.map(line => [line.id, line]));
  const planOf = Object.fromEntries(plans.map(plan => [plan.id, plan]));
  const charted = timeline.goals.filter(line => line.path !== null);
  const name = (line) => line.goal.account_name;

  const monthNote = (month, i) => {
    const reached = charted.filter(line => planOf[line.id].reachMonth === month)
      .map(line => `${name(line)} ${reachedWord(line)}`);
    return [i === 0 ? 'now' : null, ...reached].filter(Boolean).map(note => ` (${note})`).join('');
  };

  return (
    <section className="chart-container goal-plan">
      <h3>Goal plan</h3>
      {goals.length === 0 ? (
        <p className="no-data">No goals yet. Set them in Budgeting, under Goals.</p>
      ) : (
        <>
          <p className="chart-note">Goals run in order; each one's monthly amount moves to the next once it's reached.</p>
          {goals.filter(goal => planOf[goal.id]?.status === 'held').map(goal => (
            <p key={goal.id} className="goal-plan-held">{heldText(goal)}</p>
          ))}
          {timeline.handoffs.map(handoff => (
            <p key={handoff.month} className="goal-plan-handoff">
              {`${monthLabel(handoff.month)}: ${name(byId[handoff.from])} ${reachedWord(byId[handoff.from])} → ${name(byId[handoff.to])}`}
            </p>
          ))}
          {charted.map(line => (
            <figure key={line.id} className="goal-plan-panel">
              <figcaption>
                <strong>{`${line.goal.position}. ${name(line)}`}</strong>
                {` · ${headedText(line, planOf[line.id], timeline.months[0])}`}
              </figcaption>
              <GoalPlanChart
                line={line} months={timeline.months} funding={timeline.funding}
                handoffs={timeline.handoffs} reachMonth={planOf[line.id].reachMonth}
              />
            </figure>
          ))}
          {charted.length > 0 && (
            <ViewAsTable
              caption="Goal plan, month by month"
              columns={['Month', ...charted.map(line => (line.owed ? `${name(line)} (owed)` : name(line))), 'Goes to']}
              rows={timeline.months.map((month, i) => {
                const funded = timeline.funding[i];
                return [
                  `${monthLabel(month)}${monthNote(month, i)}`,
                  ...charted.map(line => formatCents(line.path[i])),
                  funded ? `${name(byId[funded.id])}, ${formatCents(funded.cents)}` : '—',
                ];
              })}
            />
          )}
        </>
      )}
    </section>
  );
}

export default GoalPlan;
