import { useState } from 'react';
import { Info } from 'lucide-react';
import FrequencySelect from './transactions/FrequencySelect';
import { todayISO } from '../utils/dates';

const EMPTY_BASE = (accounts) => ({
  account_id: accounts?.[0]?.id || '',
  date: todayISO(),
  vendor: '',
  category: '',
  amount: '',
  notes: '',
  is_transfer: false,
  is_reimbursement: false,
  transfer_to_account_id: null,   // a transfer's other account, which gets the matching transaction
});

const EMPTY_RECURRING = {
  frequency: 1,
  frequency_unit: 'months',
  number: -1,   // -1 = infinite
};

function TransactionForm({ onSubmit, onSubmitRecurring, onCancel, accounts, defaultRecurring = false }) {
  const [base, setBase] = useState(EMPTY_BASE(accounts));
  const [isRecurring, setIsRecurring] = useState(defaultRecurring);
  const [recurring, setRecurring] = useState(EMPTY_RECURRING);
  const [includePast, setIncludePast] = useState(false);

  const setB = (field, value) => setBase(prev => ({ ...prev, [field]: value }));
  const setR = (field, value) => setRecurring(prev => ({ ...prev, [field]: value }));

  // "Mark as": Transfer, Reimbursement or Recurring, one at a time; choosing the marked one again
  // clears it. Leaving Transfer forgets its To account.
  const MARKS = [['transfer', 'Transfer', base.is_transfer], ['reimbursement', 'Reimbursement', base.is_reimbursement],
                 ['recurring', 'Recurring', isRecurring]];
  const mark = (kind) => {
    const on = !MARKS.find(([k]) => k === kind)[2];
    setBase(prev => ({
      ...prev,
      is_transfer: on && kind === 'transfer',
      is_reimbursement: on && kind === 'reimbursement',
      transfer_to_account_id: on && kind === 'transfer' ? prev.transfer_to_account_id : null,
    }));
    setIsRecurring(on && kind === 'recurring');
  };

  // A recurring template dated in the past would generate every missed occurrence at once
  const isPastDate = base.date < todayISO();

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isRecurring) {
      const { transfer_to_account_id, ...fields } = base;
      onSubmitRecurring({
        ...fields,
        start_date: base.date,
        next_date: base.date,
        frequency: recurring.frequency,
        frequency_unit: recurring.frequency_unit,
        number: parseInt(recurring.number),
        skip_past: isPastDate && !includePast,
      });
    } else {
      onSubmit(base);
    }
    setBase(EMPTY_BASE(accounts));
    setRecurring(EMPTY_RECURRING);
    setIncludePast(false);
    setIsRecurring(defaultRecurring);
  };

  return (
    <form onSubmit={handleSubmit} className="transaction-form">
      {/* Base fields */}
      <div className="form-group">
        <label>Account</label>
        <select
          value={base.account_id}
          onChange={e => {
            // A transfer can't go to the account it comes from
            const id = parseInt(e.target.value);
            setBase(prev => ({ ...prev, account_id: id,
                               transfer_to_account_id: prev.transfer_to_account_id === id ? null : prev.transfer_to_account_id }));
          }}
          required
        >
          <option value="">— select account —</option>
          {accounts?.map(a => <option key={a.id} value={a.id}>{a.account_name}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label>Date</label>
        <input type="date" value={base.date} onChange={e => setB('date', e.target.value)} required />
      </div>
      <div className="form-group">
        <label>Vendor</label>
        <input type="text" value={base.vendor} onChange={e => setB('vendor', e.target.value)} placeholder="e.g., Netflix" required />
      </div>
      <div className="form-group">
        <label>Category</label>
        <input type="text" value={base.category} onChange={e => setB('category', e.target.value)} placeholder="e.g., Subscriptions" required />
      </div>
      <div className="form-group">
        <label>Amount <span className="info-tip" data-tip="Negative = expense, positive = income"><Info /></span></label>
        <input type="number" step="0.01" value={base.amount} onChange={e => setB('amount', e.target.value)} required />
      </div>
      <div className="form-group">
        <label>Notes <small>(optional)</small></label>
        <input type="text" value={base.notes} onChange={e => setB('notes', e.target.value)} />
      </div>

      {/* "Mark as": hidden when the form is locked to recurring (the Recurring tab's form) */}
      {!defaultRecurring && (
        <div className="mark-as-row">
          <span className="mark-as-label">Mark as</span>
          {MARKS.map(([kind, label, on]) => (
            <button key={kind} type="button" className={`mark-as-btn${on ? ' active' : ''}`} onClick={() => mark(kind)}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* A transfer's other account, optional: it gets the matching transaction, linked to this one */}
      {base.is_transfer && (
        <div className="form-group">
          <label htmlFor="transfer-to-account">To account</label>
          <select
            id="transfer-to-account"
            value={base.transfer_to_account_id ?? ''}
            onChange={e => setB('transfer_to_account_id', e.target.value ? parseInt(e.target.value) : null)}
          >
            <option value="">None</option>
            {accounts?.filter(a => a.id !== base.account_id).map(a => <option key={a.id} value={a.id}>{a.account_name}</option>)}
          </select>
          <small className="account-field-hint">Adds the matching transaction there.</small>
        </div>
      )}

      {/* Recurring fields: always shown in the Recurring tab's form, else when Recurring is marked */}
      {isRecurring && (
        <div className="recurring-extra-fields">
          {isPastDate && (
            <div className="recurring-past-note">
              <p>
                This date is in the past. The template will start at its next occurrence from today,
                so past ones (which may already be in your transactions) aren't added again.
              </p>
              <label className="recurring-toggle-label">
                <input type="checkbox" checked={includePast} onChange={e => setIncludePast(e.target.checked)} />
                Also add the past occurrences
              </label>
            </div>
          )}
          <div className="form-group">
            <label htmlFor="recurring-frequency">Repeats</label>
            <FrequencySelect
              id="recurring-frequency"
              frequency={recurring.frequency}
              unit={recurring.frequency_unit}
              onChange={schedule => setRecurring(prev => ({ ...prev, ...schedule }))}
            />
          </div>
          <div className="form-group">
            <label>Number of occurrences <small>(-1 = infinite)</small></label>
            <input
              type="number"
              min="-1"
              value={recurring.number}
              onChange={e => {
                const val = e.target.value;
                if (val === '' || val === '-') { setR('number', val); return; }
                if (parseInt(val) === 0) return;
                setR('number', val);
              }}
            />
          </div>
        </div>
      )}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary">
          {isRecurring ? 'Add Recurring' : 'Add Transaction'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default TransactionForm;
