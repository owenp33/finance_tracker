import { useState } from 'react';

const EMPTY_BASE = (accounts) => ({
  account_id: accounts?.[0]?.id || '',
  date: new Date().toISOString().split('T')[0],
  vendor: '',
  category: '',
  amount: '',
  notes: '',
  is_transfer: false,
});

const EMPTY_RECURRING = {
  frequency: 30,
  number: -1,   // -1 = infinite
};

function TransactionForm({ onSubmit, onSubmitRecurring, onCancel, accounts }) {
  const [base, setBase] = useState(EMPTY_BASE(accounts));
  const [isRecurring, setIsRecurring] = useState(false);
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
    setIsRecurring(false);
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
        <label>Amount</label>
        <input type="number" step="0.01" value={base.amount} onChange={e => setB('amount', e.target.value)} placeholder="Negative = expense" required />
      </div>
      <div className="form-group">
        <label>Notes <small>(optional)</small></label>
        <input type="text" value={base.notes} onChange={e => setB('notes', e.target.value)} />
      </div>

      {/* Transfer toggle */}
      <div className="recurring-toggle-row">
        <label className="recurring-toggle-label">
          <input
            type="checkbox"
            checked={base.is_transfer}
            onChange={e => setB('is_transfer', e.target.checked)}
          />
          Mark as transfer
        </label>
      </div>

      {/* Recurring toggle */}
      <div className="recurring-toggle-row">
        <label className="recurring-toggle-label">
          <input
            type="checkbox"
            checked={isRecurring}
            onChange={e => setIsRecurring(e.target.checked)}
          />
          Make this a recurring transaction
        </label>
      </div>

      {/* Expandable recurring fields */}
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
            <label>Number of occurrences <small>(-1 = infinite)</small></label>
            <input
              type="number"
              min="-1"
              value={recurring.number}
              onChange={e => setR('number', e.target.value)}
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
