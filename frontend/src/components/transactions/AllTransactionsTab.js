import { useState, useEffect } from 'react';
import TransactionForm from '../TransactionForm';
import TransactionList from '../TransactionList';
import FilterPanel from '../FilterPanel';
import { PAGE_SIZE, getMonthRange, getPeriodLabel, getCurrentPeriod, sortList } from './utils';

function AllTransactionsTab({
  transactions,
  accounts,
  onAdd,
  onAddRecurring,
  onEdit,
  onDelete,
  onDeleteMany,
  onToggleTransfer,
  onToggleTransferMany,
  onGoToImport,
}) {
  const [showForm, setShowForm] = useState(false);

  const [currentPeriod, setCurrentPeriod] = useState(getCurrentPeriod);
  const [dateFrom, setDateFrom] = useState(() => getMonthRange(getCurrentPeriod())[0]);
  const [dateTo,   setDateTo]   = useState(() => getMonthRange(getCurrentPeriod())[1]);

  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectedCategories, setSelectedCategories] = useState(new Set());
  const [datePreset, setDatePreset] = useState('');

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedTxIds, setSelectedTxIds] = useState(new Set());
  const [allSort, setAllSort] = useState('date-desc');

  // Reset pagination and selection whenever filters or date range change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setSelectedTxIds(new Set());
  }, [selectedIds, selectedCategories, dateFrom, dateTo, searchQuery]);

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

  return (
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
          <button className="btn btn-secondary" onClick={onGoToImport}>Import</button>
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
          <button className="tx-search-clear" onClick={() => setSearchQuery('')} title="Clear search">×</button>
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
  );
}

export default AllTransactionsTab;
