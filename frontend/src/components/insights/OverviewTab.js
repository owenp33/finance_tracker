import React, { useState, useMemo } from 'react';
import { useCategoryColors } from '../../CategoryColorContext';
import FilterPanel from '../FilterPanel';
import { computeAnalytics, PRESETS, presetDates } from './analytics';
import SummaryCards from './SummaryCards';
import MonthlyTrendsChart from './charts/MonthlyTrendsChart';
import CategoryPieChart from './charts/CategoryPieChart';
import TopVendorsChart from './charts/TopVendorsChart';
import CategoryBreakdownTable from './CategoryBreakdownTable';
import WeeklyAverages from './WeeklyAverages';

function OverviewTab({ transactions = [], accounts = [] }) {
  const { getColor } = useCategoryColors();

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
  const spendingPieData = analytics.spending_by_category?.map(cat => ({
    name: cat.category, value: cat.total,
  })) || [];

  const incomePieData = analytics.income_by_category?.map(cat => ({
    name: cat.category, value: cat.total,
  })) || [];

  const monthlyTrendData = (analytics.monthly_summary?.map(month => ({
    month: month.month,
    income:   month.income,
    expenses: month.expenses,
    net:      month.net,
  })) || []).slice().reverse();

  const topVendorsData = analytics.top_vendors?.slice(0, 10) || [];

  return (
    <div className="analytics-dashboard">
      {header}

      <SummaryCards summary={analytics.summary} />

      <div className="charts-grid">
        <MonthlyTrendsChart data={monthlyTrendData} />
        <CategoryPieChart
          title="Spending by Category"
          data={spendingPieData}
          getColor={getColor}
          emptyLabel="No expense data available"
        />
        <CategoryPieChart
          title="Income by Category"
          data={incomePieData}
          getColor={getColor}
          emptyLabel="No income data available"
        />
        <TopVendorsChart data={topVendorsData} />
        <CategoryBreakdownTable rows={analytics.spending_by_category} />
        <WeeklyAverages trends={analytics.trends} />
      </div>
    </div>
  );
}

export default OverviewTab;
