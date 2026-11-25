import { useState } from 'react';
import { Pencil, Trash2, Info, Unlink } from 'lucide-react';
import TransactionForm from '../TransactionForm';
import GroupedTransactionList from './GroupedTransactionList';
import TransactionChips from './TransactionChips';
import FrequencySelect from './FrequencySelect';
import RecurringSuggestions from './RecurringSuggestions';
import FindRecurring from './FindRecurring';
import { sortList, dateStrToDate, formatDate, frequencyLabel } from './utils';
import { todayISO } from '../../utils/dates';
import { formatCents } from '../../utils/money';
import { isFinished, recurringCosts } from '../../utils/recurring';

function RecurringTab({
  transactions,
  accounts,
  recurringTransactions,
  onAdd,
  onAddRecurring,
  onEdit,
  onDelete,
  onDeleteMany,
  onEditRecurring,
  onDeleteRecurring,
  onLinkToRecurring,
  onDismissSuggestion,
  onUnlinkFromRecurring,
  onAddDetectedSeries,
  onDismissDetectedSeries,
}) {
  const [showForm, setShowForm] = useState(false);
  const [showFinder, setShowFinder] = useState(false);
  const [reviewingIds, setReviewingIds] = useState(new Set());
  const [recurringSort, setRecurringSort] = useState('date-asc');

  const [editingRecurringId, setEditingRecurringId] = useState(null);
  const [recurringEditFields, setRecurringEditFields] = useState({});
  const [expandedRecurringIds, setExpandedRecurringIds] = useState(new Set());
  const [recurringBulkAmount, setRecurringBulkAmount] = useState('');
  // The series card tapped open (phones show its Edit / Delete only then), one at a time
  const [openCardId, setOpenCardId] = useState(null);

  // A tap on a card's line, not on one of its buttons, opens or closes its actions
  const toggleCard = (e, id) => {
    if (e.target.closest('button, input, select, label, a, [role="button"]')) return;
    setOpenCardId(open => (open === id ? null : id));
  };

  const toggleRecurringExpand = (id) =>
    setExpandedRecurringIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const toggleReviewing = (id) =>
    setReviewingIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  // The loan accounts a series could pay down (any but its own account)
  const loanAccounts = (r) => accounts.filter(a => a.kind === 'loan' && a.id !== r.account_id);
  const accountName = (id) => accounts.find(a => a.id === id)?.account_name;

  const startEditRecurring = (r) => {
    setOpenCardId(null);
    setEditingRecurringId(r.id);
    setRecurringEditFields({
      vendor: r.vendor, category: r.category, amount: r.amount,
      frequency: r.frequency, frequency_unit: r.frequency_unit, next_date: r.next_date,
      notes: r.notes || '', number: r.number ?? -1,
      // Sent only when there's a loan to choose (or one to stop paying down)
      ...(loanAccounts(r).length > 0 || r.loan_account_id != null ? { loan_account_id: r.loan_account_id ?? null } : {}),
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

  // Finished templates (limited, every occurrence used) never generate again; they're listed apart
  const sortedRecurring = sortList(recurringTransactions, recurringSort, 'next_date');
  const active = sortedRecurring.filter(r => !isFinished(r));
  const finished = sortedRecurring.filter(isFinished);

  // What the active series cost per month (Insights → Recurring has the breakdown)
  const costs = recurringCosts(recurringTransactions, transactions, todayISO());

  // The date of a series' latest transaction (undefined when it has none)
  const lastPaymentDate = (recurringId) =>
    transactions.filter(t => t.recurring_id === recurringId).map(t => t.date).sort().pop();

  // One template's card, in the active list or under Finished
  const renderTemplate = (r) => (
    <div key={r.id} className={`recurring-item${openCardId === r.id ? ' series-open' : ''}`}>
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
          {(() => {
            // Saving a new vendor or category renames the whole series (the backend applies it)
            const seriesCount = transactions.filter(t => t.recurring_id === r.id).length;
            const renamed = recurringEditFields.vendor !== r.vendor || recurringEditFields.category !== r.category;
            return renamed && seriesCount > 0 && (
              <p className="recurring-series-note">
                Also updates the {seriesCount} transaction{seriesCount !== 1 ? 's' : ''} in this series
              </p>
            );
          })()}
          <div className="form-group">
            <label>Amount <span className="info-tip" data-tip="Negative = expense, positive = income"><Info /></span></label>
            <input type="number" step="0.01" value={recurringEditFields.amount} onChange={e => setRF('amount', e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor={`recurring-${r.id}-frequency`}>Repeats</label>
            <FrequencySelect
              id={`recurring-${r.id}-frequency`}
              frequency={recurringEditFields.frequency}
              unit={recurringEditFields.frequency_unit}
              onChange={schedule => setRecurringEditFields(prev => ({ ...prev, ...schedule }))}
            />
          </div>
          <div className="form-group">
            <label>Next Date</label>
            <input type="date" value={recurringEditFields.next_date} onChange={e => setRF('next_date', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Notes <small>(optional)</small></label>
            <input type="text" value={recurringEditFields.notes} onChange={e => setRF('notes', e.target.value)} />
          </div>
          {'loan_account_id' in recurringEditFields && (() => {
            // The series' payments start (or stop) counting on a loan when the loan changes
            const chosen = recurringEditFields.loan_account_id;
            const payments = transactions.filter(t => t.recurring_id === r.id && t.amount_cents !== 0).length;
            const plural = payments !== 1 ? 's' : '';
            let note = null;
            if (chosen !== (r.loan_account_id ?? null) && payments > 0) {
              note = chosen != null
                ? `Counts the ${payments} payment${plural} in this series toward ${accountName(chosen)}`
                : `Stops counting the ${payments} payment${plural} in this series toward ${accountName(r.loan_account_id)}`;
            }
            return (
              <div className="form-group">
                <label htmlFor={`recurring-${r.id}-loan`}>Pays down</label>
                <select
                  id={`recurring-${r.id}-loan`}
                  value={chosen ?? ''}
                  onChange={e => setRF('loan_account_id', e.target.value === '' ? null : Number(e.target.value))}
                >
                  <option value="">No loan</option>
                  {loanAccounts(r).map(a => <option key={a.id} value={a.id}>{a.account_name}</option>)}
                </select>
                {note && <p className="recurring-series-note">{note}</p>}
              </div>
            );
          })()}
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
          <div className="recurring-item-row" onClick={e => toggleCard(e, r.id)}>
            <div className="recurring-info">
              <strong>
                {r.vendor}
                {r.needs_attention && <span className="needs-attention-badge">Needs attention</span>}
              </strong>
              {(() => {
                // A finished series shows its last payment's date (its schedule's can be a few
                // days off), always with the year; it can have no occurrences left (its only
                // ones were removed)
                const finishedSeries = isFinished(r);
                const displayDate = finishedSeries ? (lastPaymentDate(r.id) ?? r.last_date) : r.next_date;
                const when = displayDate
                  ? `${finishedSeries ? 'Last' : 'Next'}: ${formatDate(displayDate, finishedSeries || dateStrToDate(r.date).getFullYear() !== dateStrToDate(displayDate).getFullYear())}`
                  : 'No occurrences';
                // A series paying down a loan names the loan, not the account it's charged to
                const account = accountName(r.account_id);
                const loan = r.loan_account_id != null ? accountName(r.loan_account_id) : null;
                return (
                  <span>
                    {r.category} · {frequencyLabel(r.frequency, r.frequency_unit)} · {when}
                    {loan ? ` · Pays down ${loan}` : account && ` · ${account}`}
                  </span>
                );
              })()}
              {r.notes && <small>{r.notes}</small>}
            </div>
            <div className="recurring-item-right">
              <span className={`transaction-amount ${r.amount >= 0 ? 'green' : 'red'}`}>
                {r.amount >= 0 ? '+' : '-'}${Math.abs(r.amount).toFixed(2)}
              </span>
              <span className="series-card-actions">
                <button className="btn btn-ghost btn-sm icon-btn" title="Edit" onClick={() => startEditRecurring(r)}>
                  <Pencil size={14} /><span className="tx-action-label">Edit</span>
                </button>
                <button className="btn btn-danger btn-sm icon-btn" title="Delete" onClick={() => handleDeleteRecurring(r.id)}>
                  <Trash2 size={14} /><span className="tx-action-label">Delete</span>
                </button>
              </span>
            </div>
          </div>
          {r.suggestion_count > 0 && (
            <div className="recurring-generated">
              <button className="recurring-generated-toggle" onClick={() => toggleReviewing(r.id)}>
                {reviewingIds.has(r.id) ? '▲' : '▼'} {r.suggestion_count} suggested transaction{r.suggestion_count !== 1 ? 's' : ''} to review
              </button>
              {reviewingIds.has(r.id) && (
                <RecurringSuggestions
                  template={r}
                  onLink={onLinkToRecurring}
                  onDismiss={onDismissSuggestion}
                  onDelete={onDelete}
                />
              )}
            </div>
          )}
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
                  {isExpanded ? '▲' : '▼'} {generated.length} transaction{generated.length !== 1 ? 's' : ''} in this series
                </button>
                {isExpanded && (
                  // Like an account's list on the Accounts tab; a series' rows have no other account,
                  // so the middle shows their notes and chips
                  <GroupedTransactionList
                    transactions={generated}
                    label="Transactions"
                    renderMiddle={t => (
                      <span className="series-row-details">
                        {t.notes && <span className="series-row-notes">{t.notes}</span>}
                        <TransactionChips t={t} />
                      </span>
                    )}
                    renderBulkActions={(selected, clearSelection) => (
                      <>
                        <div className="recurring-bulk-amount">
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
                              for (const t of selected) {
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
                          onClick={async () => {
                            await onUnlinkFromRecurring(r.id, selected.map(t => t.id));
                            clearSelection();
                          }}
                        >
                          Remove {selected.length} from series
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={async () => {
                            await onDeleteMany(selected.map(t => t.id));
                            clearSelection();
                          }}
                        >
                          Delete {selected.length}
                        </button>
                      </>
                    )}
                    extraActions={t => (
                      <button
                        className="btn btn-ghost btn-sm icon-btn transfer-action-btn"
                        title="Remove from series"
                        aria-label="Remove from series"
                        onClick={() => onUnlinkFromRecurring(r.id, [t.id])}
                      ><Unlink size={13} /><span className="tx-action-label">Remove</span></button>
                    )}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                )}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );

  return (
    <div className="recurring-view">
      <div className="view-header">
        <h2>Recurring Transactions <span className="count-badge">{active.length}</span></h2>
        <div className="view-header-actions">
          <select className="sort-select" value={recurringSort} onChange={e => setRecurringSort(e.target.value)}>
            <option value="date-asc">Next date (soonest)</option>
            <option value="date-desc">Next date (latest)</option>
            <option value="amount-desc">Amount (high → low)</option>
            <option value="amount-asc">Amount (low → high)</option>
            <option value="vendor-asc">Vendor (A → Z)</option>
            <option value="vendor-desc">Vendor (Z → A)</option>
          </select>
          <button className="btn btn-ghost" onClick={() => setShowFinder(f => !f)}>
            {showFinder ? 'Hide found series' : 'Find recurring'}
          </button>
          <button className="btn btn-primary" onClick={() => setShowForm(f => !f)}>
            {showForm ? 'Cancel' : '+ Add Recurring'}
          </button>
        </div>
      </div>
      {costs.activeCount > 0 && (
        <p className="recurring-summary">
          {`Active recurring costs: ${formatCents(costs.total)}/mo across ${costs.activeCount} series`}
        </p>
      )}
      {showFinder && (
        <FindRecurring accounts={accounts} onAdd={onAddDetectedSeries} onDismiss={onDismissDetectedSeries} />
      )}
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
        {active.length === 0 ? (
          <p className="no-data">
            {finished.length > 0 ? 'No active recurring transactions' : 'No recurring transactions found'}
          </p>
        ) : (
          active.map(renderTemplate)
        )}
      </div>
      {finished.length > 0 && (
        <>
          <h3 className="recurring-finished-heading">
            Finished <span className="count-badge">{finished.length}</span>
          </h3>
          <div className="recurring-list">{finished.map(renderTemplate)}</div>
        </>
      )}
    </div>
  );
}

export default RecurringTab;
