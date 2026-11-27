import { useState } from 'react';
import { Pencil, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { formatCents } from '../../utils/money';
import { monthRangeLabel } from '../../utils/dates';
import LoanPayoff from './LoanPayoff';

const STATUS = { active: 'Active', waiting: 'Waiting', held: 'Reached' };

// Where a goal stands: savings "$3,000.00 of $7,500.00"; a loan "$75,217.00 owed · goal: paid off"
const progressText = (goal) => {
  if (goal.account_kind !== 'loan') return `${formatCents(goal.balance_cents)} of ${formatCents(goal.target_cents)}`;
  const owed = Math.max(-goal.balance_cents, 0);
  const aim = goal.target_cents === 0 ? 'paid off' : `${formatCents(-goal.target_cents)} owed`;
  return `${formatCents(owed)} owed · goal: ${aim}`;
};

// What the plan says (utils/goals.js goalPlan): held, or its monthly amount and when it's reached
const planText = (goal, plan, before) => {
  const loanPaidOff = goal.account_kind === 'loan' && goal.target_cents === 0;
  if (plan.status === 'held') {
    return loanPaidOff ? 'Reached: paid off' : `Reached: keep it at ${formatCents(goal.target_cents)} or more`;
  }
  const parts = [];
  if (plan.status === 'waiting' && before) parts.push(`After ${before}`);
  parts.push(plan.monthlyCents > 0
    ? `${formatCents(plan.monthlyCents)} a month (${plan.own ? 'yours' : 'suggested'})`
    : 'Nothing goes toward it');
  parts.push(plan.months === null
    ? 'not reached at this pace'
    : `${loanPaidOff ? 'paid off' : 'reached'} by ${monthRangeLabel(plan.reachMonth, plan.reachMonth)}`);
  return parts.join(' · ');
};

// One goal in the Goals section: its place, account, status, progress and plan, a loan goal's payoff
// (`payoff`, utils/goals.js loanPayoff; null otherwise), with editing its target and monthly amount
// (blank: the suggestion), moving it up or down, and deleting it
function GoalRow({ goal, plan, payoff, before, isFirst, isLast, onEdit, onMove, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState('');
  const [monthly, setMonthly] = useState('');

  const startEditing = () => {
    setTarget(String(goal.target_cents / 100));
    setMonthly(goal.monthly_cents == null ? '' : String(goal.monthly_cents / 100));
    setEditing(true);
  };

  const save = async () => {
    const saved = await onEdit(goal.id, { target: Number(target), monthly: monthly.trim() === '' ? null : Number(monthly) });
    if (saved) setEditing(false);
  };

  const share = goal.target_cents > 0 ? Math.min(Math.max(goal.balance_cents / goal.target_cents, 0), 1) : 1;

  return (
    <li className="goal-row">
      <div className="goal-main">
        <div className="goal-heading">
          <strong className="goal-name">{`${goal.position}. ${goal.account_name}`}</strong>
          <span className={`goal-status ${plan.status}`}>{STATUS[plan.status]}</span>
        </div>
        <div className="goal-progress">{progressText(goal)}</div>
        {goal.account_kind !== 'loan' && (
          <div className="goal-bar" aria-hidden="true">
            <div className="goal-bar-fill" style={{ width: `${Math.round(share * 100)}%` }} />
          </div>
        )}
        <div className="goal-plan">{planText(goal, plan, before)}</div>
        {payoff && <LoanPayoff goal={goal} payoff={payoff} />}
        {editing && (
          <div className="goal-form">
            <div className="form-group">
              <label htmlFor={`goal-${goal.id}-target`}>Target balance</label>
              <input id={`goal-${goal.id}-target`} type="number" step="0.01" value={target} onChange={e => setTarget(e.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor={`goal-${goal.id}-monthly`}>Monthly amount</label>
              <input id={`goal-${goal.id}-monthly`} type="number" step="0.01" value={monthly}
                     onChange={e => setMonthly(e.target.value)}
                     placeholder={`Suggested: ${formatCents(plan.suggestedCents)}`} />
              <small className="account-field-hint">Leave it blank to use the suggestion.</small>
            </div>
            <div className="form-actions">
              <button className="btn btn-primary btn-sm" disabled={target.trim() === ''} onClick={save}>Save</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
      <div className="goal-actions">
        <button className="btn btn-ghost btn-sm icon-btn" title="Move up" aria-label="Move up" disabled={isFirst}
                onClick={() => onMove(-1)}><ChevronUp size={14} /></button>
        <button className="btn btn-ghost btn-sm icon-btn" title="Move down" aria-label="Move down" disabled={isLast}
                onClick={() => onMove(1)}><ChevronDown size={14} /></button>
        <button className="btn btn-ghost btn-sm icon-btn" title="Edit" aria-label="Edit" onClick={startEditing}><Pencil size={14} /></button>
        <button className="btn btn-danger btn-sm icon-btn" title="Delete" aria-label="Delete" onClick={onDelete}><Trash2 size={14} /></button>
      </div>
    </li>
  );
}

export default GoalRow;
