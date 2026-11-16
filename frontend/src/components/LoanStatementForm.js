import { useState } from 'react';
import { todayISO } from '../utils/dates';

// A loan's "Update from statement": the statement's date and the balance owed (as the statement
// shows it, a positive amount), sent as the account's balance, negative when owed. onSubmit
// resolves to whether it's done (the parent then closes the form); after a failure the form
// stays as typed.
function LoanStatementForm({ account, onSubmit, onCancel }) {
  const [date, setDate] = useState('');
  const [owed, setOwed] = useState('');
  const [saving, setSaving] = useState(false);
  const ready = date !== '' && owed.trim() !== '' && Number.isFinite(Number(owed));

  const submit = async () => {
    setSaving(true);
    const done = await onSubmit({ date, balance: -Number(owed) });
    if (!done) setSaving(false);
  };

  return (
    <div className="loan-statement-form">
      <div className="form-group">
        <label htmlFor={`statement-${account.id}-date`}>Statement date</label>
        <input
          id={`statement-${account.id}-date`}
          type="date"
          max={todayISO()}
          value={date}
          onChange={e => setDate(e.target.value)}
        />
      </div>
      <div className="form-group">
        <label htmlFor={`statement-${account.id}-owed`}>Balance owed</label>
        <input
          id={`statement-${account.id}-owed`}
          type="number"
          step="0.01"
          value={owed}
          onChange={e => setOwed(e.target.value)}
          placeholder="0.00"
        />
        <small className="account-field-hint">
          As the statement shows it. The difference from the balance here at the end of that day is
          booked as a statement adjustment: interest, fees, anything not entered here.
        </small>
      </div>
      <div className="account-edit-actions">
        <button className="btn btn-primary btn-sm" disabled={!ready || saving} onClick={submit}>Update</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default LoanStatementForm;
