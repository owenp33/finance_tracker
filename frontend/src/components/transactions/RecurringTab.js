import { useState } from 'react';
import { Pencil, Trash2, Info } from 'lucide-react';
import TransactionForm from '../TransactionForm';
import TransactionList from '../TransactionList';
import { sortList, dateStrToDate, formatDate, subtractDays, frequencyLabel } from './utils';

function RecurringTab({
  transactions,
  accounts,
  recurringTransactions,
  onAdd,
  onAddRecurring,
  onEdit,
  onDelete,
  onDeleteMany,
  onToggleTransfer,
  onToggleTransferMany,
  onEditRecurring,
  onDeleteRecurring,
}) {
  const [showForm, setShowForm] = useState(false);
  const [recurringSort, setRecurringSort] = useState('date-asc');

  const [editingRecurringId, setEditingRecurringId] = useState(null);
  const [recurringEditFields, setRecurringEditFields] = useState({});
  const [expandedRecurringIds, setExpandedRecurringIds] = useState(new Set());
  const [selectedRecurringTxIds, setSelectedRecurringTxIds] = useState(new Set());
  const [recurringBulkAmount, setRecurringBulkAmount] = useState('');

  const toggleRecurringExpand = (id) =>
    setExpandedRecurringIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const toggleSelectRecurringTx = (id) =>
    setSelectedRecurringTxIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const startEditRecurring = (r) => {
    setEditingRecurringId(r.id);
    setRecurringEditFields({
      vendor: r.vendor, category: r.category, amount: r.amount,
      frequency: r.frequency, next_date: r.next_date,
      notes: r.notes || '', number: r.number ?? -1,
    });
  };

  const setRF = (field, val) =>
    setRecurringEditFields(prev => ({ ...prev, [field]: val }));

  const saveEditRecurring = async (id) => {
    await onEditRecurring(id, recurringEditFields);
    setEditingRecurringId(null);
  };

  const handleDeleteRecurring = (id) => {
    if (!window.confirm('Delete this recurring template? Future occurrences will stop being generated.')) return;
    onDeleteRecurring(id);
  };

  const sortedRecurring = sortList(recurringTransactions, recurringSort, 'next_date');

  return (
    <div className="recurring-view">
      <div className="view-header">
        <h2>Recurring Transactions <span className="count-badge">{recurringTransactions.length}</span></h2>
        <div className="view-header-actions">
          <select className="sort-select" value={recurringSort} onChange={e => setRecurringSort(e.target.value)}>
            <option value="date-asc">Next date (soonest)</option>
            <option value="date-desc">Next date (latest)</option>
            <option value="amount-desc">Amount (high → low)</option>
            <option value="amount-asc">Amount (low → high)</option>
            <option value="vendor-asc">Vendor (A → Z)</option>
            <option value="vendor-desc">Vendor (Z → A)</option>
          </select>
          <button className="btn btn-primary" onClick={() => setShowForm(f => !f)}>
            {showForm ? 'Cancel' : '+ Add Recurring'}
          </button>
        </div>
      </div>
      {showForm && (
        <TransactionForm
          onSubmit={async (data) => { await onAdd(data); setShowForm(false); }}
          onSubmitRecurring={async (data) => { await onAddRecurring(data); setShowForm(false); }}
          onCancel={() => setShowForm(false)}
          accounts={accounts}
          defaultRecurring={true}
        />
      )}
      <div className="recurring-list">
        {recurringTransactions.length === 0 ? (
          <p className="no-data">No recurring transactions found</p>
        ) : (
          sortedRecurring.map(r => (
            <div key={r.id} className="recurring-item">
              {editingRecurringId === r.id ? (
                <div className="recurring-edit-form">
                  <div className="form-group">
                    <label>Vendor</label>
                    <input type="text" value={recurringEditFields.vendor} onChange={e => setRF('vendor', e.target.value)} placeholder="e.g., Netflix" />
                  </div>
                  <div className="form-group">
                    <label>Category</label>
                    <input type="text" value={recurringEditFields.category} onChange={e => setRF('category', e.target.value)} placeholder="e.g., Subscriptions" />
                  </div>
                  <div className="form-group">
                    <label>Amount <span className="info-tip" data-tip="Negative = expense, positive = income"><Info /></span></label>
                    <input type="number" step="0.01" value={recurringEditFields.amount} onChange={e => setRF('amount', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Frequency</label>
                    <select value={recurringEditFields.frequency} onChange={e => setRF('frequency', parseInt(e.target.value))}>
                      <option value={7}>Weekly (7 days)</option>
                      <option value={14}>Biweekly (14 days)</option>
                      <option value={30}>Monthly (30 days)</option>
                      <option value={60}>Every 2 months (60 days)</option>
                      <option value={90}>Quarterly (90 days)</option>
                      <option value={365}>Yearly (365 days)</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Next Date</label>
                    <input type="date" value={recurringEditFields.next_date} onChange={e => setRF('next_date', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Notes <small>(optional)</small></label>
                    <input type="text" value={recurringEditFields.notes} onChange={e => setRF('notes', e.target.value)} />
                  </div>
                  <div className="form-group recurring-number-group">
                    {(() => {
                      const minNumber = Math.max(1, r.idx - 1);
                      return (
                        <>
                          <label className="recurring-number-label">
                            <input type="checkbox" checked={recurringEditFields.number !== -1} onChange={e => setRF('number', e.target.checked ? minNumber : -1)} />
                            Limit occurrences
                          </label>
                          {recurringEditFields.number !== -1 && (
                            <input type="number" min={minNumber} value={recurringEditFields.number} onChange={e => { const n = parseInt(e.target.value); setRF('number', (!n || n < minNumber) ? minNumber : n); }} placeholder="Max occurrences" />
                          )}
                        </>
                      );
                    })()}
                  </div>
                  <div className="form-actions">
                    <button className="btn btn-primary btn-sm" onClick={() => saveEditRecurring(r.id)}>Save</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingRecurringId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="recurring-item-row">
                    <div className="recurring-info">
                      <strong>{r.vendor}</strong>
                      {(() => {
                        const isFinished = r.number !== -1 && r.idx > r.number;
                        const displayDate = isFinished ? subtractDays(r.next_date, r.frequency) : r.next_date;
                        const displayYear = typeof displayDate === 'string' ? dateStrToDate(displayDate).getFullYear() : displayDate.getFullYear();
                        const spansYears = dateStrToDate(r.date).getFullYear() !== displayYear;
                        return (
                          <span>
                            {r.category} · {frequencyLabel(r.frequency)} · {isFinished ? 'Last' : 'Next'}: {formatDate(displayDate, spansYears)}
                          </span>
                        );
                      })()}
                      {r.notes && <small>{r.notes}</small>}
                    </div>
                    <div className="recurring-item-right">
                      <span className={`transaction-amount ${r.amount >= 0 ? 'green' : 'red'}`}>
                        {r.amount >= 0 ? '+' : '-'}${Math.abs(r.amount).toFixed(2)}
                      </span>
                      <button className="btn btn-ghost btn-sm icon-btn" title="Edit" onClick={() => startEditRecurring(r)}><Pencil size={14} /></button>
                      <button className="btn btn-danger btn-sm icon-btn" title="Delete" onClick={() => handleDeleteRecurring(r.id)}><Trash2 size={14} /></button>
                    </div>
                  </div>
                  {(() => {
                    const generated = transactions
                      .filter(t => t.recurring_id === r.id)
                      .sort((a, b) => b.date.localeCompare(a.date));
                    if (generated.length === 0) return null;
                    const isExpanded = expandedRecurringIds.has(r.id);
                    return (
                      <div className="recurring-generated">
                        <button
                          className="recurring-generated-toggle"
                          onClick={() => toggleRecurringExpand(r.id)}
                        >
                          {isExpanded ? '▲' : '▼'} {generated.length} generated transaction{generated.length !== 1 ? 's' : ''}
                        </button>
                        {isExpanded && (
                          <div className="recurring-generated-list">
                            {(() => {
                              const sectionSelected = generated.filter(t => selectedRecurringTxIds.has(t.id));
                              const allSectionSelected = generated.length > 0 && generated.every(t => selectedRecurringTxIds.has(t.id));
                              const someSectionSelected = sectionSelected.length > 0;
                              const allAreTransfers = someSectionSelected && sectionSelected.every(t => t.is_transfer);

                              const toggleSelectAllSection = () => {
                                if (allSectionSelected) {
                                  setSelectedRecurringTxIds(prev => {
                                    const n = new Set(prev); generated.forEach(t => n.delete(t.id)); return n;
                                  });
                                } else {
                                  setSelectedRecurringTxIds(prev => {
                                    const n = new Set(prev); generated.forEach(t => n.add(t.id)); return n;
                                  });
                                }
                              };

                              return (
                                <>
                                  <div className="recurring-bulk-actions">
                                    <label className="bulk-select-all">
                                      <input
                                        type="checkbox"
                                        checked={allSectionSelected}
                                        ref={el => { if (el) el.indeterminate = someSectionSelected && !allSectionSelected; }}
                                        onChange={toggleSelectAllSection}
                                      />
                                      <span>
                                        {someSectionSelected
                                          ? `${sectionSelected.length} of ${generated.length} selected`
                                          : `Select all ${generated.length}`}
                                      </span>
                                    </label>
                                    <div className="recurring-bulk-right">
                                      <div
                                        className="recurring-bulk-amount"
                                        style={!someSectionSelected ? { visibility: 'hidden', pointerEvents: 'none' } : {}}
                                      >
                                          <span>Change amount to</span>
                                          <input
                                            type="number"
                                            step="0.01"
                                            className="recurring-bulk-amount-input"
                                            value={recurringBulkAmount}
                                            onChange={e => setRecurringBulkAmount(e.target.value)}
                                            placeholder="0.00"
                                          />
                                          <button
                                            className="btn btn-primary btn-sm"
                                            disabled={!recurringBulkAmount || isNaN(parseFloat(recurringBulkAmount))}
                                            onClick={async () => {
                                              const amount = parseFloat(recurringBulkAmount);
                                              for (const t of sectionSelected) {
                                                await onEdit(t.id, {
                                                  date: t.date, vendor: t.vendor, category: t.category,
                                                  amount, notes: t.notes || '', account_id: t.account_id,
                                                });
                                              }
                                              setRecurringBulkAmount('');
                                            }}
                                          >
                                            Apply
                                          </button>
                                      </div>
                                      <button
                                        className="btn btn-ghost btn-sm"
                                        onClick={() => onToggleTransferMany(sectionSelected.map(t => t.id))}
                                        style={!someSectionSelected ? { visibility: 'hidden', pointerEvents: 'none' } : {}}
                                      >
                                        {allAreTransfers ? 'Unmark transfer' : 'Mark as transfer'}
                                      </button>
                                      <button
                                        className="btn btn-danger btn-sm"
                                        onClick={async () => {
                                          await onDeleteMany(sectionSelected.map(t => t.id));
                                          setSelectedRecurringTxIds(prev => {
                                            const n = new Set(prev);
                                            sectionSelected.forEach(t => n.delete(t.id));
                                            return n;
                                          });
                                        }}
                                        style={!someSectionSelected ? { visibility: 'hidden', pointerEvents: 'none' } : {}}
                                      >
                                        Delete {sectionSelected.length || '—'}
                                      </button>
                                    </div>
                                  </div>
                                  <TransactionList
                                    transactions={generated}
                                    accounts={accounts}
                                    onEdit={onEdit}
                                    onDelete={onDelete}
                                    onToggleTransfer={onToggleTransfer}
                                    showAll={true}
                                    selectedIds={selectedRecurringTxIds}
                                    onToggle={toggleSelectRecurringTx}
                                  />
                                </>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default RecurringTab;
