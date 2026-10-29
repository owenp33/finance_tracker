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

  // A recurring template dated in the past would generate every missed occurrence at once
  const isPastDate = base.date < todayISO();

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isRecurring) {
      onSubmitRecurring({
        ...base,
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
        <select value={base.account_id} onChange={e => setB('account_id', parseInt(e.target.value))} required>
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

      {/* Mark as pill group + recurring toggle — hidden when form is locked to recurring mode */}
      {!defaultRecurring && (
        <>
          <div className="mark-as-row">
            <span className="mark-as-label">Mark as</span>
            <button
              type="button"
              className={`mark-as-btn${base.is_transfer ? ' active' : ''}`}
              onClick={() => {
                const next = !base.is_transfer;
                setB('is_transfer', next);
                setB('is_reimbursement', false);
                if (next) setIsRecurring(false);
              }}
            >Transfer</button>
            <button
              type="button"
              className={`mark-as-btn${base.is_reimbursement ? ' active' : ''}`}
              onClick={() => {
                const next = !base.is_reimbursement;
                setB('is_reimbursement', next);
                setB('is_transfer', false);
                if (next) setIsRecurring(false);
              }}
            >Reimbursement</button>
          </div>
          <div className="recurring-toggle-row">
            <label className="recurring-toggle-label">
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={e => { setIsRecurring(e.target.checked); if (e.target.checked) { setB('is_transfer', false); setB('is_reimbursement', false); } }}
              />
              Make this recurring
            </label>
          </div>
        </>
      )}

      {/* Recurring fields — always visible when defaultRecurring, otherwise expandable */}
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
