import { useState, useEffect } from 'react';

const formatDate = (dateStr) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const formatAmount = (amount) =>
  `${amount >= 0 ? '+' : '-'}$${Math.abs(amount).toFixed(2)}`;

function TransactionList({ transactions, accounts = [], onEdit, onDelete, showAll = false, resetSignal, onStartEdit, compact = false }) {
  const [editingId, setEditingId] = useState(null);
  const [editFields, setEditFields] = useState({});

  useEffect(() => {
    if (resetSignal) {
      setEditingId(null);
      setEditFields({});
    }
  }, [resetSignal]);

  if (!transactions || transactions.length === 0) {
    return <p className="no-data">No transactions found</p>;
  }

  const startEdit = (t) => {
    onStartEdit?.();
    setEditingId(t.id);
    setEditFields({
      date: t.date,
      vendor: t.vendor,
      category: t.category,
      amount: t.amount,
      notes: t.notes || '',
      account_id: t.account_id,
    });
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (id) => {
    await onEdit(id, editFields);
    setEditingId(null);
  };

  const set = (field, value) => setEditFields(prev => ({ ...prev, [field]: value }));

  return (
    <div className="transaction-list">
      {transactions.map(t => (
        <div key={t.id} className="transaction-item">
          {editingId === t.id ? (
            <div className="transaction-edit-form">
              {accounts.length > 0 && (
                <div className="form-group">
                  <label>Account</label>
                  <select value={editFields.account_id} onChange={e => set('account_id', parseInt(e.target.value))}>
                    {accounts.map(a => (
                      <option key={a.id} value={a.id}>{a.account_name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="form-group">
                <label>Date</label>
                <input type="date" value={editFields.date} onChange={e => set('date', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Vendor</label>
                <input type="text" value={editFields.vendor} onChange={e => set('vendor', e.target.value)} placeholder="e.g., Netflix" />
              </div>
              <div className="form-group">
                <label>Category</label>
                <input type="text" value={editFields.category} onChange={e => set('category', e.target.value)} placeholder="e.g., Subscriptions" />
              </div>
              <div className="form-group">
                <label>Amount <small>(negative = expense)</small></label>
                <input type="number" step="0.01" value={editFields.amount} onChange={e => set('amount', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Notes <small>(optional)</small></label>
                <input type="text" value={editFields.notes} onChange={e => set('notes', e.target.value)} />
              </div>
              <div className="form-actions">
                <button className="btn btn-primary btn-sm" onClick={() => saveEdit(t.id)}>Save</button>
                <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>Cancel</button>
              </div>
            </div>
          ) : compact ? (
            <>
              <div className="transaction-info">
                <strong>{t.vendor}</strong>
                <span>{t.category} | {formatDate(t.date)}</span>
              </div>
              <div className={`transaction-amount ${t.amount >= 0 ? 'green' : 'red'}`}>
                {formatAmount(t.amount)}
              </div>
            </>
          ) : (
            <>
              <div className="transaction-info">
                <strong>{t.vendor}</strong>
                <span>{t.category} • {formatDate(t.date)}{t.account_name ? ` • ${t.account_name}` : ''}</span>
                {t.notes && <small>{t.notes}</small>}
              </div>
              <div className="transaction-right">
                <div className={`transaction-amount ${t.amount >= 0 ? 'green' : 'red'}`}>
                  {formatAmount(t.amount)}
                </div>
                {showAll && (
                  <>
                    <button className="btn btn-ghost btn-sm" onClick={() => startEdit(t)}>Edit</button>
                    <button className="btn btn-danger btn-sm" onClick={() => { setEditingId(null); onDelete(t.id); }}>Delete</button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export default TransactionList;
