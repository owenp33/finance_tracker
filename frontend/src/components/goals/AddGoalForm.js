import { useState } from 'react';

// Adding a goal: an account, the balance to reach (a loan's starts at 0, paid off) and, optionally,
// the goal's own monthly amount (blank: the app's suggestion). onAdd resolves to whether it worked.
function AddGoalForm({ accounts, onAdd, onCancel }) {
  const [accountId, setAccountId] = useState('');
  const [target, setTarget] = useState('');
  const [monthly, setMonthly] = useState('');
  const [saving, setSaving] = useState(false);

  const pickAccount = (value) => {
    setAccountId(value);
    const account = accounts.find(a => String(a.id) === value);
    if (account?.kind === 'loan' && target.trim() === '') setTarget('0');
  };

  const ready = accountId !== '' && target.trim() !== '' && Number.isFinite(Number(target));

  const submit = async () => {
    setSaving(true);
    const added = await onAdd({
      account_id: Number(accountId),
      target: Number(target),
      monthly: monthly.trim() === '' ? null : Number(monthly),
    });
    if (!added) setSaving(false);
  };

  return (
    <div className="goal-form">
      <div className="form-group">
        <label htmlFor="new-goal-account">Account</label>
        <select id="new-goal-account" value={accountId} onChange={e => pickAccount(e.target.value)}>
          <option value="">— account —</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.account_name}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label htmlFor="new-goal-target">Target balance</label>
        <input id="new-goal-target" type="number" step="0.01" value={target} onChange={e => setTarget(e.target.value)}
               placeholder="e.g. 7500" />
        <small className="account-field-hint">The balance to reach: savings up to an amount, or 0 for a loan paid off.</small>
      </div>
      <div className="form-group">
        <label htmlFor="new-goal-monthly">Monthly amount</label>
        <input id="new-goal-monthly" type="number" step="0.01" value={monthly} onChange={e => setMonthly(e.target.value)}
               placeholder="Suggested" />
        <small className="account-field-hint">Leave it blank to use the suggestion.</small>
      </div>
      <div className="form-actions">
        <button className="btn btn-primary btn-sm" disabled={!ready || saving} onClick={submit}>Add goal</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default AddGoalForm;
