import { useState, useEffect } from 'react';
import { Pencil, Trash2, Info } from 'lucide-react';
import TransactionForm from './TransactionForm';
import TransactionList from './TransactionList';
import FilterPanel from './FilterPanel';
import ImportView from './ImportView';
import AccountsView from './AccountsView';

const formatDate = (dateStr) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const frequencyLabel = (days) => {
  const map = { 7: 'Weekly', 14: 'Biweekly', 30: 'Monthly', 60: 'Every 2 months', 90: 'Quarterly', 365: 'Yearly' };
  return map[days] || `Every ${days} days`;
};

const PAGE_SIZE = 10;

function getMonthRange(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDate = new Date(year, month, 0).getDate();
  const last = `${year}-${String(month).padStart(2, '0')}-${String(lastDate).padStart(2, '0')}`;
  return [first, last];
}

function getPeriodLabel(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) return 'All Time';
  const from = new Date(dateFrom + 'T00:00:00');
  const to   = new Date(dateTo   + 'T00:00:00');
  const isFullMonth =
    from.getDate() === 1 &&
    to.getDate() === new Date(to.getFullYear(), to.getMonth() + 1, 0).getDate() &&
    from.getMonth() === to.getMonth() &&
    from.getFullYear() === to.getFullYear();
  if (isFullMonth) {
    return from.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  const fLabel = from.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const tLabel = to.toLocaleDateString('en-US',   { month: 'long', year: 'numeric' });
  return fLabel === tLabel ? fLabel : `${fLabel} — ${tLabel}`;
}

function getCurrentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function TransactionsView({
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
  onPairTransfer,
  onBreakTransferLink,
  onDeleteTransferBulk,
  onEditRecurring,
  onDeleteRecurring,
  onImportDone,
  onCreateAccount,
  onEditAccount,
  onDeleteAccount,
}) {
  const [tab, setTab] = useState('all');
  const [showForm, setShowForm] = useState(false);

  // All tab — period nav
  const [currentPeriod, setCurrentPeriod] = useState(getCurrentPeriod);
  const [dateFrom, setDateFrom] = useState(() => getMonthRange(getCurrentPeriod())[0]);
  const [dateTo,   setDateTo]   = useState(() => getMonthRange(getCurrentPeriod())[1]);

  // All tab — filters
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectedCategories, setSelectedCategories] = useState(new Set());
  const [datePreset, setDatePreset] = useState('');

  // All tab — pagination
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // All tab — bulk selection
  const [selectedTxIds, setSelectedTxIds] = useState(new Set());

  // Sorting
  const [allSort,       setAllSort]       = useState('date-desc');
  const [recurringSort, setRecurringSort] = useState('date-asc');
  const [flaggedSort,   setFlaggedSort]   = useState('date-desc');

  // Recurring tab — inline edit
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

  // Reset pagination and selection whenever filters or date range change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setSelectedTxIds(new Set());
  }, [selectedIds, selectedCategories, dateFrom, dateTo, searchQuery]);

  // ── All tab ──────────────────────────────────────────────────────────────

  const navigatePeriod = (dir) => {
    const [year, month] = currentPeriod.split('-').map(Number);
    const d = new Date(year, month - 1 + dir, 1);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    setCurrentPeriod(next);
    const [first, last] = getMonthRange(next);
    setDateFrom(first);
    setDateTo(last);
    setDatePreset('');
  };

  const applyPreset = (preset) => {
    setDatePreset(preset);
    const today = new Date();
    const toISO = d => d.toISOString().slice(0, 10);
    if (preset === 'all') { setDateFrom(''); setDateTo(''); return; }
    if (preset === 'ytd') { setDateFrom(`${today.getFullYear()}-01-01`); setDateTo(toISO(today)); return; }
    const months = { '1m': 1, '3m': 3, '6m': 6, '1y': 12 }[preset];
    const d = new Date(today);
    d.setMonth(d.getMonth() - months);
    setDateFrom(toISO(d));
    setDateTo(toISO(today));
  };

  const allCategories = [...new Set(transactions.map(t => t.category))].sort();

  const toggleAccount = (id) =>
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleCategory = (cat) =>
    setSelectedCategories(prev => { const n = new Set(prev); n.has(cat) ? n.delete(cat) : n.add(cat); return n; });

  const [periodFrom, periodTo] = getMonthRange(currentPeriod);
  const dateFilterModified = dateFrom !== periodFrom || dateTo !== periodTo;

  const activeFilterCount =
    (selectedIds.size > 0 ? 1 : 0) +
    (selectedCategories.size > 0 ? 1 : 0) +
    (dateFilterModified ? 1 : 0);

  const clearAllFilters = () => {
    setSelectedIds(new Set());
    setSelectedCategories(new Set());
    setDateFrom(periodFrom);
    setDateTo(periodTo);
    setDatePreset('');
  };

  const sortList = (list, sort, dateKey = 'date') => {
    const s = [...list];
    switch (sort) {
      case 'date-desc':   return s.sort((a, b) => b[dateKey].localeCompare(a[dateKey]));
      case 'date-asc':    return s.sort((a, b) => a[dateKey].localeCompare(b[dateKey]));
      case 'amount-desc': return s.sort((a, b) => b.amount - a.amount);
      case 'amount-asc':  return s.sort((a, b) => a.amount - b.amount);
      case 'vendor-asc':  return s.sort((a, b) => a.vendor.localeCompare(b.vendor));
      case 'vendor-desc': return s.sort((a, b) => b.vendor.localeCompare(a.vendor));
      default: return s;
    }
  };

  const searchLower = searchQuery.toLowerCase();
  const filtered = transactions.filter(t => {
    if (selectedIds.size > 0 && !selectedIds.has(t.account_id)) return false;
    if (selectedCategories.size > 0 && !selectedCategories.has(t.category)) return false;
    if (dateFrom && t.date < dateFrom) return false;
    if (dateTo && t.date > dateTo) return false;
    if (searchLower && !t.vendor.toLowerCase().includes(searchLower)) return false;
    return true;
  });

  const sortedFiltered = sortList(filtered, allSort);
  const visible = sortedFiltered.slice(0, visibleCount);

  const toggleSelectTx = (id) =>
    setSelectedTxIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const allVisibleSelected = visible.length > 0 && visible.every(t => selectedTxIds.has(t.id));

  const toggleSelectAllTx = () => {
    if (allVisibleSelected) {
      setSelectedTxIds(prev => { const n = new Set(prev); visible.forEach(t => n.delete(t.id)); return n; });
    } else {
      setSelectedTxIds(prev => { const n = new Set(prev); visible.forEach(t => n.add(t.id)); return n; });
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedTxIds);
    await onDeleteMany(ids);
    setSelectedTxIds(new Set());
  };

  const selectedTransferCount = Array.from(selectedTxIds)
    .filter(id => sortedFiltered.find(tx => tx.id === id)?.is_transfer).length;
  const allSelectedAreTransfers = selectedTxIds.size > 0 && selectedTransferCount === selectedTxIds.size;

  const handleBulkMarkTransfer = async () => {
    const ids = allSelectedAreTransfers
      ? Array.from(selectedTxIds)
      : Array.from(selectedTxIds).filter(id => {
          const t = sortedFiltered.find(tx => tx.id === id);
          return t && !t.is_transfer;
        });
    if (ids.length === 0) return;
    await onToggleTransferMany(ids);
  };

  // ── Recurring tab ────────────────────────────────────────────────────────

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

  // ── Flagged tab ──────────────────────────────────────────────────────────

  const flagged = sortList(transactions.filter(t => t.over_budget), flaggedSort);
  const sortedRecurring = sortList(recurringTransactions, recurringSort, 'next_date');

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="transactions-view">
      <div className="tab-bar">
        <button className={`tab-btn${tab === 'all'       ? ' active' : ''}`} onClick={() => setTab('all')}>All</button>
        <button className={`tab-btn${tab === 'recurring' ? ' active' : ''}`} onClick={() => setTab('recurring')}>Recurring</button>
        <button className={`tab-btn${tab === 'accounts'  ? ' active' : ''}`} onClick={() => setTab('accounts')}>Accounts</button>
        <button className={`tab-btn${tab === 'import'    ? ' active' : ''}`} onClick={() => setTab('import')}>Import</button>
        <button className={`tab-btn${tab === 'flagged'   ? ' active' : ''}`} onClick={() => setTab('flagged')}>
          Flagged {flagged.length > 0 && <span className="count-badge flagged-badge">{flagged.length}</span>}
        </button>
      </div>

      {/* ── All ───────────────────────────────────────────────────────────── */}
      {tab === 'all' && (
        <>
          {/* Header row */}
          <div className="view-header">
            <h2>Transactions <span className="count-badge">{filtered.length}</span></h2>
            <div className="view-header-actions">
              <button
                className={`btn btn-secondary${activeFilterCount > 0 ? ' filter-btn-active' : ''}`}
                onClick={() => setShowFilters(f => !f)}
              >
                Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''} {showFilters ? '▲' : '▼'}
              </button>
              <select className="sort-select" value={allSort} onChange={e => { setAllSort(e.target.value); setVisibleCount(PAGE_SIZE); }}>
                <option value="date-desc">Date (newest)</option>
                <option value="date-asc">Date (oldest)</option>
                <option value="amount-desc">Amount (high → low)</option>
                <option value="amount-asc">Amount (low → high)</option>
                <option value="vendor-asc">Vendor (A → Z)</option>
                <option value="vendor-desc">Vendor (Z → A)</option>
              </select>
              <button className="btn btn-secondary" onClick={() => setTab('import')}>Import</button>
              <button className="btn btn-primary" onClick={() => setShowForm(f => !f)}>
                {showForm ? 'Cancel' : '+ Add Transaction'}
              </button>
            </div>
          </div>

          {/* Search bar */}
          <div className="tx-search-bar">
            <input
              type="text"
              className="tx-search-input"
              placeholder="Search by vendor..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="tx-search-clear" onClick={() => setSearchQuery('')} title="Clear search">Ã—</button>
            )}
          </div>

          {/* Period navigator */}
          <div className="period-nav">
            <button className="btn btn-ghost btn-sm" onClick={() => navigatePeriod(-1)}>‹</button>
            <span className="period-label">{getPeriodLabel(dateFrom, dateTo)}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => navigatePeriod(1)}>›</button>
          </div>

          {/* Filter panel */}
          {showFilters && (
            <FilterPanel
              accounts={accounts}
              selectedAccountIds={selectedIds}
              onAccountToggle={toggleAccount}
              onAccountSelectAll={() => setSelectedIds(new Set(accounts.map(a => a.id)))}
              onAccountClear={() => setSelectedIds(new Set())}
              allCategories={allCategories}
              selectedCategories={selectedCategories}
              onCategoryToggle={toggleCategory}
              onCategorySelectAll={() => setSelectedCategories(new Set(allCategories))}
              onCategoryClear={() => setSelectedCategories(new Set())}
              startDate={dateFrom}
              endDate={dateTo}
              onStartDateChange={(val) => { setDateFrom(val); setDatePreset('custom'); }}
              onEndDateChange={(val) => { setDateTo(val); setDatePreset('custom'); }}
              showDateClear={dateFilterModified}
              onDateClear={() => { setDateFrom(periodFrom); setDateTo(periodTo); setDatePreset(''); }}
              presets={[['all','All Time'],['1m','1M'],['3m','3M'],['6m','6M'],['1y','1Y'],['ytd','YTD']]}
              datePreset={datePreset}
              onPresetChange={applyPreset}
              activeFilterCount={activeFilterCount}
              onClearAll={clearAllFilters}
            />
          )}

          {showForm && (
            <TransactionForm
              onSubmit={async (data) => { await onAdd(data); setShowForm(false); }}
              onSubmitRecurring={async (data) => { await onAddRecurring(data); setShowForm(false); }}
              onCancel={() => setShowForm(false)}
              accounts={accounts}
            />
          )}

          {/* Bulk action bar */}
          {sortedFiltered.length > 0 && (
            <div className="bulk-action-bar">
              <label className="bulk-select-all">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={el => { if (el) el.indeterminate = selectedTxIds.size > 0 && !allVisibleSelected; }}
                  onChange={toggleSelectAllTx}
                />
                <span>{selectedTxIds.size > 0 ? `${selectedTxIds.size} of ${sortedFiltered.length} selected` : `Select all ${visible.length}`}</span>
              </label>
              <div className="bulk-actions">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={handleBulkMarkTransfer}
                  style={selectedTxIds.size === 0 ? { visibility: 'hidden', pointerEvents: 'none' } : {}}
                >
                  {allSelectedAreTransfers ? 'Unmark as transfer' : 'Mark as transfer'}
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={handleBulkDelete}
                  style={selectedTxIds.size === 0 ? { visibility: 'hidden', pointerEvents: 'none' } : {}}
                >
                  Delete {selectedTxIds.size || '—'} selected
                </button>
              </div>
            </div>
          )}

          <TransactionList
            transactions={visible}
            accounts={accounts}
            onEdit={onEdit}
            onDelete={onDelete}
            onToggleTransfer={onToggleTransfer}
            showAll={true}
            resetSignal={showForm}
            onStartEdit={() => setShowForm(false)}
            selectedIds={selectedTxIds}
            onToggle={toggleSelectTx}
          />

          {/* Load more / count bar */}
          {filtered.length > 0 && (
            <div className="load-more-bar">
              <span className="load-more-label">
                Showing {Math.min(visibleCount, filtered.length)} of {filtered.length} transactions
              </span>
              {visibleCount < filtered.length && (
                <>
                  <button className="btn btn-ghost btn-sm" onClick={() => setVisibleCount(n => n + PAGE_SIZE)}>
                    Load more
                  </button>
                  {filtered.length > 20 && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setVisibleCount(filtered.length)}>
                      Load all ({filtered.length})
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Recurring ─────────────────────────────────────────────────────── */}
      {tab === 'recurring' && (
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
                          <span>{r.category} · {frequencyLabel(r.frequency)} · Next: {formatDate(r.next_date)}</span>
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
      )}

      {/* ── Import ────────────────────────────────────────────────────────── */}
      {tab === 'import' && (
        <ImportView
          accounts={accounts}
          onImportDone={onImportDone}
          onNavigateAway={() => setTab('all')}
        />
      )}

      {/* ── Accounts ─────────────────────────────────────────────────────── */}
      {tab === 'accounts' && (
        <AccountsView
          transactions={transactions}
          accounts={accounts}
          onEdit={onEdit}
          onDelete={onDelete}
          onPairTransfer={onPairTransfer}
          onDeleteTransferBulk={onDeleteTransferBulk}
          onCreateAccount={onCreateAccount}
          onEditAccount={onEditAccount}
          onDeleteAccount={onDeleteAccount}
        />
      )}

      {/* ── Flagged ───────────────────────────────────────────────────────── */}
      {tab === 'flagged' && (
        <div>
          <div className="view-header">
            <h2>Over-Budget Transactions <span className="count-badge flagged-badge">{flagged.length}</span></h2>
            <div className="view-header-actions">
              <select className="sort-select" value={flaggedSort} onChange={e => setFlaggedSort(e.target.value)}>
                <option value="date-desc">Date (newest)</option>
                <option value="date-asc">Date (oldest)</option>
                <option value="amount-desc">Amount (high → low)</option>
                <option value="amount-asc">Amount (low → high)</option>
                <option value="vendor-asc">Vendor (A → Z)</option>
                <option value="vendor-desc">Vendor (Z → A)</option>
              </select>
            </div>
          </div>
          {flagged.length === 0 ? (
            <p className="no-data">No over-budget transactions — you're on track!</p>
          ) : (
            <TransactionList transactions={flagged} accounts={accounts} onEdit={onEdit} onDelete={onDelete} showAll={true} resetSignal={showForm} onStartEdit={() => setShowForm(false)} />
          )}
        </div>
      )}
    </div>
  );
}

export default TransactionsView;
