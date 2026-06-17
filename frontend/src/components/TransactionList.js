import { useState, useEffect, useMemo } from 'react';
import { Pencil, Trash2, ArrowLeftRight, Info } from 'lucide-react';
import { useCategoryColors } from '../CategoryColorContext';

const formatDate = (dateStr) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const formatAmount = (amount) =>
  `${amount >= 0 ? '+' : '-'}$${Math.abs(amount).toFixed(2)}`;

function TransactionList({ transactions, accounts = [], onEdit, onDelete, onToggleTransfer, onPairTransfer, showAll = false, resetSignal, onStartEdit, compact = false, selectedIds, onToggle }) {
  const [editingId, setEditingId] = useState(null);
  const [editFields, setEditFields] = useState({});
  const { getColor } = useCategoryColors();

  // Fallback for transactions missing a backend-computed recurring_index — only
  // accurate if every occurrence in the series is present in `transactions`.
  const recurringOccurrences = useMemo(() => {
    const groups = {};
    for (const t of transactions) {
      if (t.recurring_id && t.recurring_index == null) {
        if (!groups[t.recurring_id]) groups[t.recurring_id] = [];
        groups[t.recurring_id].push(t);
      }
    }
    const result = {};
    for (const group of Object.values(groups)) {
      group.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id);
      group.forEach((t, i) => {
        result[t.id] = { occurrence: i + 1, total: t.recurring_number ?? -1 };
      });
    }
    return result;
  }, [transactions]);

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
      is_transfer: t.is_transfer || false,
      is_reimbursement: t.is_reimbursement || false,
    });
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (id) => {
    await onEdit(id, editFields);
    setEditingId(null);
  };

  const set = (field, value) => setEditFields(prev => ({ ...prev, [field]: value }));

  return (
    <div className={`transaction-list${compact ? ' compact' : ''}`}>
      {transactions.map(t => (
        <div key={t.id} className={`transaction-item${selectedIds?.has(t.id) ? ' tx-selected' : ''}`}>
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
                <label>Amount <span className="info-tip" data-tip="Negative = expense, positive = income"><Info /></span></label>
                <input type="number" step="0.01" value={editFields.amount} onChange={e => set('amount', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Notes <small>(optional)</small></label>
                <input type="text" value={editFields.notes} onChange={e => set('notes', e.target.value)} />
              </div>
              <div className="mark-as-row">
                <span className="mark-as-label">Mark as</span>
                <button
                  type="button"
                  className={`mark-as-btn${editFields.is_transfer ? ' active' : ''}`}
                  onClick={() => {
                    onToggleTransfer?.(t.id);
                    set('is_transfer', !editFields.is_transfer);
                    set('is_reimbursement', false);
                  }}
                >Transfer</button>
                <button
                  type="button"
                  className={`mark-as-btn${editFields.is_reimbursement ? ' active' : ''}`}
                  onClick={() => { set('is_reimbursement', !editFields.is_reimbursement); set('is_transfer', false); }}
                >Reimbursement</button>
              </div>
              <div className="form-actions">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => saveEdit(t.id)}
                  disabled={
                    editFields.date === t.date &&
                    editFields.vendor === t.vendor &&
                    editFields.category === t.category &&
                    parseFloat(editFields.amount) === t.amount &&
                    (editFields.notes || '') === (t.notes || '') &&
                    editFields.account_id === t.account_id &&
                    editFields.is_reimbursement === (t.is_reimbursement || false)
                  }
                >Save</button>
                <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>Cancel</button>
              </div>
            </div>
          ) : compact ? (
            <>
              <div className="transaction-info">
                <strong>{t.vendor}</strong>
                <span>{t.category} · {formatDate(t.date)}</span>
              </div>
              <div className={`transaction-amount ${t.amount >= 0 ? 'green' : 'red'}`}>
                {formatAmount(t.amount)}
              </div>
            </>
          ) : (
            <>
              {onToggle && (
                <input
                  type="checkbox"
                  className="tx-checkbox"
                  checked={selectedIds?.has(t.id) ?? false}
                  onChange={() => onToggle(t.id)}
                  onClick={e => e.stopPropagation()}
                />
              )}
              <span className="tx-cat-dot" style={{ background: getColor(t.category) }} title={t.category} />
              <div className="transaction-info">
                <strong>{t.vendor}</strong>
                <span>{t.category} · {formatDate(t.date)}{t.notes ? ` · ${t.notes}` : ''}</span>
              </div>
              <div className="transaction-right">
                <div className="tx-default-info">
                  {t.over_budget && <span className="tx-over-chip">Over budget</span>}
                  {t.is_transfer && (
                    <span className={`tx-transfer-chip${t.transfer_peer_id ? '' : ' tx-transfer-unlinked'}`}
                      title={t.transfer_peer_id ? undefined : 'Go to Accounts tab to link this transfer'}>
                      {t.transfer_peer_id ? 'Transfer' : 'Transfer · unlinked'}
                    </span>
                  )}
                  {t.is_reimbursement && (
                    <span className="tx-reimburse-chip" title="Offsets spending in budget calculations">
                      Reimbursement
                    </span>
                  )}
                  {t.recurring_id && (t.recurring_index != null || recurringOccurrences[t.id]) && (() => {
                    const occurrence = t.recurring_index ?? recurringOccurrences[t.id].occurrence;
                    const total = t.recurring_number ?? -1;
                    return (
                      <span className="tx-recurring-chip" title="Recurring transaction">
                        {occurrence} / {total === -1 ? '∞' : total}
                      </span>
                    );
                  })()}
                  <div className={`transaction-amount ${t.amount >= 0 ? 'green' : 'red'}`}>
                    {formatAmount(t.amount)}
                  </div>
                </div>
                <div className="tx-hover-actions">
                  {onToggleTransfer && (
                    <button
                      className={`btn btn-ghost btn-sm icon-btn${t.is_transfer ? ' tx-transfer-active' : ''}`}
                      title={t.is_transfer ? (t.transfer_peer_id ? 'Unlink transfer' : 'Unmark transfer') : 'Mark as transfer'}
                      onClick={() => onToggleTransfer(t.id)}
                    >
                      <ArrowLeftRight size={14} />
                    </button>
                  )}
                  {showAll && (
                    <>
                      <button className="btn btn-ghost btn-sm icon-btn" title="Edit" onClick={() => startEdit(t)}><Pencil size={14} /></button>
                      <button className="btn btn-danger btn-sm icon-btn" title="Delete" onClick={() => { setEditingId(null); onDelete(t.id); }}><Trash2 size={14} /></button>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export default TransactionList;
