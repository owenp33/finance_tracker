import { useState } from 'react';
import { Info } from 'lucide-react';

const EMPTY_BASE = (accounts) => ({
  account_id: accounts?.[0]?.id || '',
  date: new Date().toISOString().split('T')[0],
  vendor: '',
  category: '',
  amount: '',
  notes: '',
  is_transfer: false,
  is_reimbursement: false,
});

const EMPTY_RECURRING = {
  frequency: 30,
  number: -1,   // -1 = infinite
};

function TransactionForm({ onSubmit, onSubmitRecurring, onCancel, accounts, defaultRecurring = false }) {
  const [base, setBase] = useState(EMPTY_BASE(accounts));
  const [isRecurring, setIsRecurring] = useState(defaultRecurring);
  const [recurring, setRecurring] = useState(EMPTY_RECURRING);

  const setB = (field, value) => setBase(prev => ({ ...prev, [field]: value }));
  const setR = (field, value) => setRecurring(prev => ({ ...prev, [field]: value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isRecurring) {
      onSubmitRecurring({
        ...base,
        start_date: base.date,
        next_date: base.date,
        frequency: parseInt(recurring.frequency),
        number: parseInt(recurring.number),
      });
    } else {
      onSubmit(base);
    }
    setBase(EMPTY_BASE(accounts));
    setRecurring(EMPTY_RECURRING);
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
          <div className="form-group">
            <label>Frequency <small>(days between occurrences)</small></label>
            <select value={recurring.frequency} onChange={e => setR('frequency', e.target.value)}>
              <option value={7}>Weekly (7 days)</option>
              <option value={14}>Biweekly (14 days)</option>
              <option value={30}>Monthly (30 days)</option>
              <option value={60}>Every 2 months (60 days)</option>
              <option value={90}>Quarterly (90 days)</option>
              <option value={365}>Yearly (365 days)</option>
            </select>
          </div>
          <div className="form-group">
            <label>Number of occurrences <small>(-1 = infinite, min 2 otherwise)</small></label>
            <input
              type="number"
              min="-1"
              value={recurring.number}
              onChange={e => {
                const val = e.target.value;
                if (val === '' || val === '-') { setR('number', val); return; }
                const n = parseInt(val);
                if (n === 0 || n === 1) return;
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
