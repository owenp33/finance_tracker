import React from 'react';

/**
 * Reusable filter panel used by TransactionsView and InsightsView.
 *
 * Required props:
 *   accounts, selectedAccountIds, onAccountToggle, onAccountSelectAll, onAccountClear
 *   allCategories, selectedCategories, onCategoryToggle, onCategorySelectAll, onCategoryClear
 *   startDate, endDate, onStartDateChange, onEndDateChange
 *   showDateClear, onDateClear
 *   activeFilterCount, onClearAll
 *
 * Optional props:
 *   dateSectionLabel  — header for the date column (default: 'Date Range')
 *   presets           — array of [key, label] to render quick-pick pills
 *   datePreset        — currently active preset key
 *   onPresetChange    — (key) => void
 */
export default function FilterPanel({
  // Account
  accounts = [],
  selectedAccountIds,
  onAccountToggle,
  onAccountSelectAll,
  onAccountClear,
  // Category
  allCategories = [],
  selectedCategories,
  onCategoryToggle,
  onCategorySelectAll,
  onCategoryClear,
  // Date
  dateSectionLabel = 'Date Range',
  startDate = '',
  endDate = '',
  onStartDateChange,
  onEndDateChange,
  showDateClear = false,
  onDateClear,
  // Optional preset pills
  presets,
  datePreset,
  onPresetChange,
  // Footer
  activeFilterCount = 0,
  onClearAll,
}) {
  const allAccountsSelected = accounts.length > 0 && selectedAccountIds.size === accounts.length;
  const allCatsSelected     = allCategories.length > 0 && selectedCategories.size === allCategories.length;

  return (
    <div className="filter-panel">
      <div className="filter-panel-sections">

        {/* Period / Date Range */}
        <div className="filter-section">
          <div className="filter-section-header">
            <span>{dateSectionLabel}</span>
            {showDateClear && (
              <button className="filter-clear-btn" onClick={onDateClear}>Clear</button>
            )}
          </div>
          {presets && (
            <div className="preset-pills">
              {presets.map(([key, label]) => (
                <button
                  key={key}
                  className={`preset-pill${datePreset === key ? ' active' : ''}`}
                  onClick={() => onPresetChange(key)}
                >{label}</button>
              ))}
            </div>
          )}
          <div className="form-group" style={presets ? { marginTop: 10 } : undefined}>
            <label>From</label>
            <input type="date" value={startDate} onChange={e => onStartDateChange(e.target.value)} />
          </div>
          <div className="form-group">
            <label>To</label>
            <input type="date" value={endDate} onChange={e => onEndDateChange(e.target.value)} />
          </div>
        </div>

        {/* Account */}
        <div className="filter-section">
          <div className="filter-section-header">
            <span>Account</span>
            {selectedAccountIds.size > 0 && (
              <button className="filter-clear-btn" onClick={onAccountClear}>Clear</button>
            )}
          </div>
          <label className="filter-option filter-select-all">
            <input
              type="checkbox"
              checked={allAccountsSelected}
              onChange={() => allAccountsSelected ? onAccountClear() : onAccountSelectAll()}
            />
            <span>Select All</span>
          </label>
          {accounts.map(a => (
            <label key={a.id} className="filter-option">
              <input
                type="checkbox"
                checked={selectedAccountIds.has(a.id)}
                onChange={() => onAccountToggle(a.id)}
              />
              <span>{a.account_name}</span>
            </label>
          ))}
        </div>

        {/* Category */}
        <div className="filter-section">
          <div className="filter-section-header">
            <span>Category</span>
            {selectedCategories.size > 0 && (
              <button className="filter-clear-btn" onClick={onCategoryClear}>Clear</button>
            )}
          </div>
          <div className="filter-scroll-list">
            <label className="filter-option filter-select-all">
              <input
                type="checkbox"
                checked={allCatsSelected}
                onChange={() => allCatsSelected ? onCategoryClear() : onCategorySelectAll()}
              />
              <span>Select All</span>
            </label>
            {allCategories.map(cat => (
              <label key={cat} className="filter-option">
                <input
                  type="checkbox"
                  checked={selectedCategories.has(cat)}
                  onChange={() => onCategoryToggle(cat)}
                />
                <span>{cat}</span>
              </label>
            ))}
          </div>
        </div>

      </div>
      {activeFilterCount > 0 && (
        <div className="filter-panel-footer">
          <button className="filter-clear-btn" onClick={onClearAll}>Clear all filters</button>
        </div>
      )}
    </div>
  );
}
