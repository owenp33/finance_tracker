import React, { useState, useMemo } from 'react';
import FilterPanel from '../FilterPanel';
import { computeAnalytics, PRESETS, presetDates } from './analytics';
import SummaryCards from './SummaryCards';
import CategoryMultiples from './CategoryMultiples';
import NetByMonth from './NetByMonth';
import TopVendors from './TopVendors';
import { periodMonths, categoryPanels } from './categoryPanels';
import { monthlyNet } from './monthlyNet';
import { todayISO } from '../../utils/dates';
import { formatDollars } from '../../utils/money';
import WeeklyAverages from './WeeklyAverages';

function OverviewTab({ transactions = [], accounts = [] }) {
  // ── Filter state ──────────────────────────────────────────────────────────
  const [startDate,          setStartDate]          = useState('');
  const [endDate,            setEndDate]            = useState('');
  const [selectedAccountIds, setSelectedAccountIds] = useState(new Set());
  const [selectedCategories, setSelectedCategories] = useState(new Set());
  const [datePreset,         setDatePreset]         = useState('all');
  const [filtersOpen,        setFiltersOpen]        = useState(false);

  const allCategories = useMemo(
    () => [...new Set(transactions.map(t => t.category))].sort(),
    [transactions],
  );

  const applyPreset = (preset) => {
    const { start, end } = presetDates(preset);
    setDatePreset(preset);
    setStartDate(start);
    setEndDate(end);
  };

  const toggle = (setter, val) => setter(prev => {
    const next = new Set(prev);
    next.has(val) ? next.delete(val) : next.add(val);
    return next;
  });

  const clearFilters = () => {
    applyPreset('all');
    setSelectedAccountIds(new Set());
    setSelectedCategories(new Set());
  };

  const dateActive   = !!(startDate || endDate);
  const activeFilterCount =
    (dateActive ? 1 : 0) +
    (selectedAccountIds.size > 0 ? 1 : 0) +
    (selectedCategories.size > 0 ? 1 : 0);

  // Human-readable period for the header — shows range like "Feb 2026 – May 2026"
  const fmtDate = (d) => d
    ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null;
  const periodLabel = (() => {
    const s = fmtDate(startDate);
    const e = fmtDate(endDate);
    if (!s && !e)  return 'All Time';
    if (s && e && s === e) return s;
    if (s && e)    return `${s} – ${e}`;
    if (s)         return `From ${s}`;
    return `Until ${e}`;
  })();

  // ── Derived data ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => transactions.filter(t => {
    if (startDate && t.date < startDate) return false;
    if (endDate   && t.date > endDate)   return false;
    if (selectedAccountIds.size > 0 && !selectedAccountIds.has(t.account_id)) return false;
    if (selectedCategories.size > 0 && !selectedCategories.has(t.category))   return false;
    return true;
  }), [transactions, startDate, endDate, selectedAccountIds, selectedCategories]);

  const analytics = useMemo(() => computeAnalytics(filtered), [filtered]);

  // The monthly charts share the months the period covers: net per month, one small chart per
  // spending category, and a vendor's months in the top vendors
  const { months, partial, netRows, panels } = useMemo(() => {
    const period = periodMonths(filtered, startDate, endDate, todayISO());
    return {
      ...period,
      netRows: monthlyNet(filtered, period.months, period.partial),
      panels:  categoryPanels(filtered, period.months, period.partial),
    };
  }, [filtered, startDate, endDate]);

  // ── Header + filter panel ─────────────────────────────────────────────────
  const header = (
    <div className="insights-header-card">
      <div className="view-header">
        <h2>{periodLabel}</h2>
        <div className="view-header-actions">
          <button
            className={`btn btn-secondary${activeFilterCount > 0 ? ' filter-btn-active' : ''}`}
            onClick={() => setFiltersOpen(f => !f)}
          >
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''} {filtersOpen ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {filtersOpen && (
        <FilterPanel
          accounts={accounts}
          selectedAccountIds={selectedAccountIds}
          onAccountToggle={(id) => toggle(setSelectedAccountIds, id)}
          onAccountSelectAll={() => setSelectedAccountIds(new Set(accounts.map(a => a.id)))}
          onAccountClear={() => setSelectedAccountIds(new Set())}
          allCategories={allCategories}
          selectedCategories={selectedCategories}
          onCategoryToggle={(cat) => toggle(setSelectedCategories, cat)}
          onCategorySelectAll={() => setSelectedCategories(new Set(allCategories))}
          onCategoryClear={() => setSelectedCategories(new Set())}
          dateSectionLabel="Period"
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={(val) => { setStartDate(val); setDatePreset('custom'); }}
          onEndDateChange={(val) => { setEndDate(val); setDatePreset('custom'); }}
          showDateClear={dateActive}
          onDateClear={() => applyPreset('all')}
          presets={PRESETS}
          datePreset={datePreset}
          onPresetChange={applyPreset}
          activeFilterCount={activeFilterCount}
          onClearAll={clearFilters}
        />
      )}
    </div>
  );

  // ── Empty / loading states ────────────────────────────────────────────────
  if (!analytics) {
    return (
      <div className="analytics-dashboard">
        {header}
        <div className="analytics-loading">
          {transactions.length === 0
            ? 'No transaction data available.'
            : 'No transactions match the selected filters.'}
        </div>
      </div>
    );
  }

  // ── Chart data ────────────────────────────────────────────────────────────
  // Income by category is one line (Phase V, V5b): its largest category and that category's share
  // (worded so a category named "Income" still reads)
  const incomeRows = analytics.income_by_category;
  const incomeLine = incomeRows.length === 0 ? null
    : incomeRows.length === 1
      ? `All income: ${incomeRows[0].category} (${formatDollars(incomeRows[0].total)})`
      : `Top income: ${incomeRows[0].category}, ${formatDollars(incomeRows[0].total)} `
        + `(${Math.round((incomeRows[0].total / analytics.summary.total_income) * 100)}%)`;

  return (
    <div className="analytics-dashboard">
      {header}

      <SummaryCards summary={analytics.summary} />
      {incomeLine && <p className="income-line">{incomeLine}</p>}

      <div className="charts-grid">
        <NetByMonth rows={netRows} />
        <CategoryMultiples panels={panels} />
        <TopVendors transactions={filtered} months={months} partial={partial} />
        <WeeklyAverages trends={analytics.trends} />
      </div>
    </div>
  );
}

export default OverviewTab;
