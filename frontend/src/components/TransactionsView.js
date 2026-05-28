import { useState, useEffect } from 'react';
import { Pencil, Trash2, ArrowLeftRight } from 'lucide-react';
import { previewCSV, confirmImport } from '../api/csv';
import TransactionForm from './TransactionForm';
import TransactionList from './TransactionList';
import FilterPanel from './FilterPanel';

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
  return fLabel === tLabel ? fLabel : `${fLabel} – ${tLabel}`;
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

  // Accounts tab
  const [showAddAccountForm, setShowAddAccountForm] = useState(false);
  const [newAccountId, setNewAccountId] = useState('');
  const [newAccountName, setNewAccountName] = useState('');
  const [accountAdding, setAccountAdding] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState(null);
  const [editingAccountName, setEditingAccountName] = useState('');
  const [editingAccountIdStr, setEditingAccountIdStr] = useState('');

  // Import tab
  const [importStep, setImportStep] = useState('pick');
  const [importFile, setImportFile] = useState(null);
  const [importFallbackId, setImportFallbackId] = useState('');
  const [importRows, setImportRows] = useState([]);
  const [importSummary, setImportSummary] = useState(null);
  const [importSelected, setImportSelected] = useState(new Set());
  const [importLoading, setImportLoading] = useState(false);
  const [importSuccessMsg, setImportSuccessMsg] = useState('');

  // Reset pagination and selection whenever filters or date range change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setSelectedTxIds(new Set());
  }, [selectedIds, selectedCategories, dateFrom, dateTo]);

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

  const filtered = transactions.filter(t => {
    if (selectedIds.size > 0 && !selectedIds.has(t.account_id)) return false;
    if (selectedCategories.size > 0 && !selectedCategories.has(t.category)) return false;
    if (dateFrom && t.date < dateFrom) return false;
    if (dateTo && t.date > dateTo) return false;
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

  // ── Import tab ───────────────────────────────────────────────────────────

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file || !file.name.endsWith('.csv')) { alert('Please select a valid CSV file'); e.target.value = ''; return; }
    setImportFile(file);
    setImportSuccessMsg('');
  };

  const handlePreview = async () => {
    if (!importFile) return;
    setImportLoading(true);
    try {
      const data = await previewCSV(importFile, importFallbackId || null);
      setImportRows(data.rows);
      setImportSummary(data.summary);
      setImportSelected(new Set(
        data.rows.map((r, i) => (!r.duplicate && !r.zero_amount && r.account_id !== null ? i : null)).filter(i => i !== null)
      ));
      setImportStep('preview');
    } catch (err) { alert(`Preview failed: ${err.message}`); }
    finally { setImportLoading(false); }
  };

  const toggleImportRow = (i) =>
    setImportSelected(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const toggleImportRowTransfer = (i) =>
    setImportRows(prev => prev.map((r, idx) => idx === i ? { ...r, is_transfer: !r.is_transfer } : r));

  const handleConfirm = async () => {
    const rows = importRows.filter((_, i) => importSelected.has(i));
    if (rows.length === 0) return;
    setImportLoading(true);
    try {
      const data = await confirmImport(rows);
      setImportSuccessMsg(data.message);
      onImportDone();
      resetImport();
    } catch (err) { alert(`Import failed: ${err.message}`); }
    finally { setImportLoading(false); }
  };

  const resetImport = () => {
    setImportStep('pick'); setImportFile(null); setImportFallbackId('');
    setImportRows([]); setImportSummary(null); setImportSelected(new Set());
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
        <button className={`tab-btn${tab === 'import'    ? ' active' : ''}`} onClick={() => setTab('import')}>Import</button>
        <button className={`tab-btn${tab === 'flagged'   ? ' active' : ''}`} onClick={() => setTab('flagged')}>
          Flagged {flagged.length > 0 && <span className="count-badge flagged-badge">{flagged.length}</span>}
        </button>
        <button className={`tab-btn${tab === 'accounts'  ? ' active' : ''}`} onClick={() => setTab('accounts')}>Accounts</button>
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
              <button className="btn btn-secondary" onClick={() => setTab('import')}>Import CSV</button>
              <button className="btn btn-primary" onClick={() => setShowForm(f => !f)}>
                {showForm ? 'Cancel' : '+ Add Transaction'}
              </button>
            </div>
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
              {selectedTxIds.size > 0 && (
                <div className="bulk-actions">
                  <button className="btn btn-ghost btn-sm" onClick={handleBulkMarkTransfer}>
                    {allSelectedAreTransfers ? 'Unmark as transfer' : 'Mark as transfer'}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={handleBulkDelete}>
                    Delete {selectedTxIds.size} selected
                  </button>
                </div>
              )}
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
                        <label>Amount <small>(negative = expense)</small></label>
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
                      <div className="form-group">
                        <label className="recurring-number-label">
                          <input type="checkbox" checked={recurringEditFields.number !== -1} onChange={e => setRF('number', e.target.checked ? 1 : -1)} />
                          Limit occurrences
                        </label>
                        {recurringEditFields.number !== -1 && (
                          <input type="number" min="1" value={recurringEditFields.number} onChange={e => setRF('number', parseInt(e.target.value) || 1)} placeholder="Max occurrences" />
                        )}
                      </div>
                      <div className="form-actions">
                        <button className="btn btn-primary btn-sm" onClick={() => saveEditRecurring(r.id)}>Save</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditingRecurringId(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="recurring-info">
                        <strong>{r.vendor}</strong>
                        <span>{r.category} · {frequencyLabel(r.frequency)} · Next: {formatDate(r.next_date)}</span>
                        {r.notes && <small>{r.notes}</small>}
                      </div>
                      <div className="transaction-right">
                        <span className={`transaction-amount ${r.amount >= 0 ? 'green' : 'red'}`}>
                          {r.amount >= 0 ? '+' : '-'}${Math.abs(r.amount).toFixed(2)}
                        </span>
                        <button className="btn btn-ghost btn-sm icon-btn" title="Edit" onClick={() => startEditRecurring(r)}><Pencil size={14} /></button>
                        <button className="btn btn-danger btn-sm icon-btn" title="Delete" onClick={() => handleDeleteRecurring(r.id)}><Trash2 size={14} /></button>
                      </div>
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
        <div>
          <div className="view-header"><h2>Import CSV</h2></div>
          {importSuccessMsg && (
            <div className="import-success">
              <span>✓ {importSuccessMsg}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => { setImportSuccessMsg(''); setTab('all'); }}>View Transactions →</button>
            </div>
          )}
          {importStep === 'pick' && (
            <div className="import-pick">
              <div className="csv-format-info">
                <p><strong>Supported formats:</strong></p>
                <p>date, vendor, category, <em>expense</em>, <em>income</em>, account, notes</p>
                <p>date, vendor, category, <em>amount</em>, account, notes</p>
                <p className="csv-format-note">The <em>account</em> column is matched to your existing accounts by name.</p>
              </div>
              <div className="form-group">
                <label>Select CSV File</label>
                <input type="file" accept=".csv" onChange={handleFileChange} />
                {importFile && <p className="file-selected">✓ {importFile.name}</p>}
              </div>
              {importFile && (
                <div className="form-group">
                  <label>Fallback account <small>(only needed if your CSV has no account column)</small></label>
                  <select value={importFallbackId} onChange={e => setImportFallbackId(e.target.value)}>
                    <option value="">— CSV has an account column —</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.account_name}</option>)}
                  </select>
                </div>
              )}
              <div className="form-actions">
                <button className="btn btn-primary" onClick={handlePreview} disabled={!importFile || importLoading}>
                  {importLoading ? 'Scanning…' : 'Preview'}
                </button>
              </div>
            </div>
          )}
          {importStep === 'preview' && (
            <div className="import-preview">
              {importSummary && (
                <div className="import-summary">
                  <span>{importSummary.total} total</span>
                  <span className="green">{importSummary.importable} importable</span>
                  {importSummary.duplicates > 0 && <span className="red">{importSummary.duplicates} duplicate{importSummary.duplicates !== 1 ? 's' : ''}</span>}
                  {importSummary.unmatched > 0 && <span className="orange">{importSummary.unmatched} unmatched</span>}
                  {importSummary.zero_amount > 0 && <span className="orange">{importSummary.zero_amount} zero-amount</span>}
                  <span className="count-badge">{importSelected.size} selected</span>
                </div>
              )}
              <div className="form-actions import-actions-top">
                <button className="btn btn-primary" onClick={handleConfirm} disabled={importSelected.size === 0 || importLoading}>
                  {importLoading ? 'Importing…' : `Import ${importSelected.size} row${importSelected.size !== 1 ? 's' : ''}`}
                </button>
                <button className="btn btn-ghost" onClick={resetImport}>← Back</button>
              </div>
              <div className="import-table-wrap">
                <table className="import-table">
                  <thead>
                    <tr><th></th><th>Date</th><th>Vendor</th><th>Category</th><th>Amount</th><th>Account</th><th>Notes</th><th>Transfer</th></tr>
                  </thead>
                  <tbody>
                    {importRows.map((row, i) => {
                      const rowClass = ['import-row', row.duplicate ? 'duplicate' : '', row.zero_amount ? 'zero-amount' : '', row.account_id === null ? 'unmatched' : '', !importSelected.has(i) ? 'deselected' : ''].filter(Boolean).join(' ');
                      return (
                        <tr key={i} className={rowClass}>
                          <td><input type="checkbox" checked={importSelected.has(i)} onChange={() => toggleImportRow(i)} disabled={row.account_id === null || row.zero_amount} /></td>
                          <td>{row.date}</td><td>{row.vendor}</td>
                          <td>{row.category}</td>
                          <td className={row.amount >= 0 ? 'green' : 'red'}>{row.amount >= 0 ? '+' : '−'}${Math.abs(row.amount).toFixed(2)}</td>
                          <td>{row.account_name ?? <span className="csv-warning">unmatched</span>}</td>
                          <td><small>{row.notes}</small></td>
                          <td>
                            <button
                              className={`import-transfer-toggle${row.is_transfer ? ' active' : ''}`}
                              title={row.is_transfer ? 'Unmark as transfer' : 'Mark as transfer'}
                              onClick={() => toggleImportRowTransfer(i)}
                            >
                              <ArrowLeftRight size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="form-actions">
                <button className="btn btn-primary" onClick={handleConfirm} disabled={importSelected.size === 0 || importLoading}>
                  {importLoading ? 'Importing…' : `Import ${importSelected.size} row${importSelected.size !== 1 ? 's' : ''}`}
                </button>
                <button className="btn btn-ghost" onClick={resetImport}>← Back</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Accounts ─────────────────────────────────────────────────────── */}
      {tab === 'accounts' && (
        <div className="accounts-view">
          <div className="view-header">
            <h2>Bank Accounts</h2>
            {!showAddAccountForm && <button className="btn btn-primary" onClick={() => setShowAddAccountForm(true)}>+ Add Account</button>}
          </div>
          {showAddAccountForm && (
            <div className="account-form">
              <div className="form-group">
                <label>Account ID <small>(e.g. checking-1234)</small></label>
                <input type="text" value={newAccountId} onChange={e => setNewAccountId(e.target.value)} placeholder="checking-1234" autoFocus />
              </div>
              <div className="form-group">
                <label>Display Name</label>
                <input type="text" value={newAccountName} onChange={e => setNewAccountName(e.target.value)} placeholder="Chase Checking" />
              </div>
              <div className="form-actions">
                <button className="btn btn-primary" disabled={!newAccountId.trim() || accountAdding}
                  onClick={async () => {
                    setAccountAdding(true);
                    await onCreateAccount(newAccountId.trim(), newAccountName.trim() || newAccountId.trim());
                    setNewAccountId(''); setNewAccountName(''); setShowAddAccountForm(false); setAccountAdding(false);
                  }}>
                  {accountAdding ? 'Adding…' : 'Add'}
                </button>
                <button className="btn btn-ghost" onClick={() => { setShowAddAccountForm(false); setNewAccountId(''); setNewAccountName(''); }}>Cancel</button>
              </div>
            </div>
          )}
          <div className="accounts-list">
            {accounts.length === 0 ? (
              <p className="no-data">No accounts yet. Add one above.</p>
            ) : (
              accounts.map(a => {
                const accountTransfers = transactions
                  .filter(t => t.is_transfer && t.account_id === a.id)
                  .sort((x, y) => y.date.localeCompare(x.date));
                return (
                  <div key={a.id} className="account-item">
                    {editingAccountId === a.id ? (
                      <div className="account-edit-form">
                        <div className="form-group">
                          <label>Account ID</label>
                          <input type="text" value={editingAccountIdStr} onChange={e => setEditingAccountIdStr(e.target.value)} placeholder="e.g., checking-1234" autoFocus />
                        </div>
                        <div className="form-group">
                          <label>Display Name</label>
                          <input type="text" value={editingAccountName} onChange={e => setEditingAccountName(e.target.value)} placeholder="e.g., Chase Checking" />
                        </div>
                        <div className="account-edit-actions">
                          <button className="btn btn-primary btn-sm" onClick={async () => { await onEditAccount(a.id, { account_id: editingAccountIdStr, account_name: editingAccountName }); setEditingAccountId(null); }}>Save</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditingAccountId(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="account-item-row">
                          <div className="account-info"><strong>{a.account_name}</strong><small>{a.account_id}</small></div>
                          <div className="account-balance">${a.balance?.toFixed(2) ?? '0.00'}</div>
                          <div className="account-actions">
                            <button className="btn btn-ghost btn-sm icon-btn" title="Edit" onClick={() => { setEditingAccountId(a.id); setEditingAccountName(a.account_name); setEditingAccountIdStr(a.account_id); }}><Pencil size={14} /></button>
                            <button className="btn btn-danger btn-sm icon-btn" title="Delete" onClick={async () => { if (!window.confirm(`Delete "${a.account_name}"? This will permanently remove all its transactions and recurring items.`)) return; await onDeleteAccount(a.id); }}><Trash2 size={14} /></button>
                          </div>
                        </div>
                        {accountTransfers.length > 0 && (
                          <div className="account-transfers">
                            <div className="account-transfers-label">Transfers ({accountTransfers.length})</div>
                            {accountTransfers.map(t => (
                              <div key={t.id} className="account-transfer-row">
                                <span className="account-transfer-date">{formatDate(t.date)}</span>
                                <span className="account-transfer-vendor">{t.vendor}</span>
                                <span className="account-transfer-peer">
                                  {t.amount < 0 ? '→' : '←'}{' '}
                                  {t.transfer_peer_account ?? <span className="account-transfer-unlinked">Unlinked</span>}
                                </span>
                                <span className={`account-transfer-amount ${t.amount >= 0 ? 'green' : 'red'}`}>
                                  {t.amount >= 0 ? '+' : '-'}${Math.abs(t.amount).toFixed(2)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
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
