import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { useCategoryColors } from '../CategoryColorContext';

// Derives the same analytics shape the backend produces, from a raw transactions array.
function computeAnalytics(transactions) {
  if (!transactions || transactions.length === 0) return null;

  const expenses = transactions.filter(t => t.amount < 0);
  const income   = transactions.filter(t => t.amount >= 0);

  const totalIncome   = income.reduce((s, t) => s + t.amount, 0);
  const totalExpenses = expenses.reduce((s, t) => s + Math.abs(t.amount), 0);
  const avgTransaction = transactions.reduce((s, t) => s + Math.abs(t.amount), 0) / transactions.length;

  const groupBy = (txns, key, getValue) => {
    const map = {};
    for (const t of txns) {
      const k = t[key];
      if (!map[k]) map[k] = [];
      map[k].push(getValue(t));
    }
    return map;
  };

  const toCatRows = (map, total) =>
    Object.entries(map)
      .map(([category, vals]) => {
        const sum = vals.reduce((s, v) => s + v, 0);
        return {
          category,
          total: sum,
          average: sum / vals.length,
          count: vals.length,
          percentage: total > 0 ? ((sum / total) * 100).toFixed(1) : '0.0',
        };
      })
      .sort((a, b) => b.total - a.total);

  const spending_by_category = toCatRows(
    groupBy(expenses, 'category', t => Math.abs(t.amount)),
    totalExpenses,
  );
  const income_by_category = toCatRows(
    groupBy(income, 'category', t => t.amount),
    totalIncome,
  );

  // Monthly summary — sorted newest-first to match backend convention
  // (InsightsView reverses it for the line chart so oldest renders on the left)
  const monthMap = {};
  for (const t of transactions) {
    const m = t.date.substring(0, 7);
    if (!monthMap[m]) monthMap[m] = { income: 0, expenses: 0 };
    if (t.amount >= 0) monthMap[m].income   += t.amount;
    else               monthMap[m].expenses += Math.abs(t.amount);
  }
  const monthly_summary = Object.entries(monthMap)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, { income: inc, expenses: exp }]) => ({
      month, income: inc, expenses: exp, net: inc - exp,
    }));

  // Top vendors by absolute spend
  const vendorMap = groupBy(expenses, 'vendor', t => Math.abs(t.amount));
  const top_vendors = Object.entries(vendorMap)
    .map(([vendor, vals]) => ({ vendor, amount: vals.reduce((s, v) => s + v, 0) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  // Weekly averages over the span of the filtered transactions
  const dates  = transactions.map(t => new Date(t.date));
  const minMs  = Math.min(...dates);
  const maxMs  = Math.max(...dates);
  const weeks  = Math.max(1, (maxMs - minMs) / (7 * 24 * 60 * 60 * 1000));

  return {
    summary: {
      transaction_count: transactions.length,
      total_income:      totalIncome,
      total_expenses:    totalExpenses,
      net_amount:        totalIncome - totalExpenses,
      avg_transaction:   avgTransaction,
    },
    spending_by_category,
    income_by_category,
    monthly_summary,
    top_vendors,
    trends: {
      weekly_avg_income:    totalIncome   / weeks,
      weekly_avg_expenses:  totalExpenses / weeks,
    },
  };
}

function PieLegend({ data, getColor }) {
  const total = data.reduce((sum, e) => sum + e.value, 0);
  return (
    <div className="pie-legend">
      {data.map((entry) => (
        <div key={entry.name} className="pie-legend-item">
          <span className="pie-legend-dot" style={{ background: getColor(entry.name) }} />
          <span className="pie-legend-name">{entry.name}</span>
          <span className="pie-legend-value">
            ${entry.value.toFixed(2)}
            <span className="pie-legend-pct"> ({((entry.value / total) * 100).toFixed(1)}%)</span>
          </span>
        </div>
      ))}
    </div>
  );
}

const InsightsView = ({ transactions = [], accounts = [] }) => {
  const { getColor } = useCategoryColors();

  // ── Filter state ──────────────────────────────────────────────────────────
  const [startDate,          setStartDate]          = useState('');
  const [endDate,            setEndDate]            = useState('');
  const [selectedAccountIds, setSelectedAccountIds] = useState(new Set());
  const [selectedCategories, setSelectedCategories] = useState(new Set());
  const [accountOpen,        setAccountOpen]        = useState(false);
  const [categoryOpen,       setCategoryOpen]       = useState(false);
  const accountRef  = useRef(null);
  const categoryRef = useRef(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e) => {
      if (accountRef.current  && !accountRef.current.contains(e.target))  setAccountOpen(false);
      if (categoryRef.current && !categoryRef.current.contains(e.target)) setCategoryOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const allCategories = useMemo(
    () => [...new Set(transactions.map(t => t.category))].sort(),
    [transactions],
  );

  const toggle = (setter, val) => setter(prev => {
    const next = new Set(prev);
    next.has(val) ? next.delete(val) : next.add(val);
    return next;
  });

  const clearFilters = () => {
    setStartDate('');
    setEndDate('');
    setSelectedAccountIds(new Set());
    setSelectedCategories(new Set());
  };

  const hasFilters = startDate || endDate || selectedAccountIds.size > 0 || selectedCategories.size > 0;

  const accountLabel = selectedAccountIds.size === 0
    ? 'All Accounts'
    : selectedAccountIds.size === 1
      ? accounts.find(a => selectedAccountIds.has(a.id))?.account_name ?? '1 account'
      : `${selectedAccountIds.size} accounts`;

  const categoryLabel = selectedCategories.size === 0
    ? 'All Categories'
    : selectedCategories.size === 1
      ? [...selectedCategories][0]
      : `${selectedCategories.size} categories`;

  // ── Derived data ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => transactions.filter(t => {
    if (startDate && t.date < startDate) return false;
    if (endDate   && t.date > endDate)   return false;
    if (selectedAccountIds.size > 0 && !selectedAccountIds.has(t.account_id)) return false;
    if (selectedCategories.size > 0 && !selectedCategories.has(t.category))   return false;
    return true;
  }), [transactions, startDate, endDate, selectedAccountIds, selectedCategories]);

  const analytics = useMemo(() => computeAnalytics(filtered), [filtered]);

  // ── Filter bar (always rendered) ─────────────────────────────────────────
  const filterBar = (
    <div className="insights-filters">
      <div className="insights-filter-group">
        <label>From</label>
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
      </div>
      <div className="insights-filter-group">
        <label>To</label>
        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
      </div>

      {/* Account multi-select */}
      <div className="multi-select-dropdown" ref={accountRef}>
        <button className="dropdown-trigger" onClick={() => setAccountOpen(o => !o)} type="button">
          <span>{accountLabel}</span>
          <span className="dropdown-arrow">{accountOpen ? '▲' : '▼'}</span>
        </button>
        {accountOpen && (
          <div className="dropdown-menu">
            <div className="dropdown-header">
              <span>Filter by account</span>
              {selectedAccountIds.size > 0 && (
                <button className="dropdown-clear" onClick={() => setSelectedAccountIds(new Set())}>Clear</button>
              )}
            </div>
            {accounts.map(a => (
              <label key={a.id} className="dropdown-option">
                <input
                  type="checkbox"
                  checked={selectedAccountIds.has(a.id)}
                  onChange={() => toggle(setSelectedAccountIds, a.id)}
                />
                <span>{a.account_name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Category multi-select */}
      <div className="multi-select-dropdown" ref={categoryRef}>
        <button className="dropdown-trigger" onClick={() => setCategoryOpen(o => !o)} type="button">
          <span>{categoryLabel}</span>
          <span className="dropdown-arrow">{categoryOpen ? '▲' : '▼'}</span>
        </button>
        {categoryOpen && (
          <div className="dropdown-menu insights-category-menu">
            <div className="dropdown-header">
              <span>Filter by category</span>
              {selectedCategories.size > 0 && (
                <button className="dropdown-clear" onClick={() => setSelectedCategories(new Set())}>Clear</button>
              )}
            </div>
            {allCategories.map(cat => (
              <label key={cat} className="dropdown-option">
                <input
                  type="checkbox"
                  checked={selectedCategories.has(cat)}
                  onChange={() => toggle(setSelectedCategories, cat)}
                />
                <span>{cat}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {hasFilters && (
        <button className="btn btn-ghost btn-sm" onClick={clearFilters}>Clear filters</button>
      )}
    </div>
  );

  // ── Empty / loading states ────────────────────────────────────────────────
  if (!analytics) {
    return (
      <div className="analytics-dashboard">
        {filterBar}
        <div className="analytics-loading">
          {transactions.length === 0
            ? 'No transaction data available.'
            : 'No transactions match the selected filters.'}
        </div>
      </div>
    );
  }

  // ── Chart data (same as before) ───────────────────────────────────────────
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
      {filterBar}

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="summary-card income">
          <h3>Total Income</h3>
          <div className="amount">${analytics.summary.total_income.toLocaleString()}</div>
          <div className="subtitle">{analytics.summary.transaction_count} transactions</div>
        </div>
        <div className="summary-card expenses">
          <h3>Total Expenses</h3>
          <div className="amount">${analytics.summary.total_expenses.toLocaleString()}</div>
          <div className="subtitle">Avg: ${analytics.summary.avg_transaction.toFixed(2)}</div>
        </div>
        <div className="summary-card net">
          <h3>Net Amount</h3>
          <div className="amount">${analytics.summary.net_amount.toLocaleString()}</div>
          <div className="subtitle">
            {analytics.summary.net_amount >= 0 ? '+ Positive' : '- Negative'}
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="charts-grid">

        {/* Monthly Trends */}
        <div className="chart-container full-width">
          <h3>Monthly Trends</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={monthlyTrendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
              <Legend />
              <Line type="monotone" dataKey="income"   stroke="#00C49F" strokeWidth={2} name="Income" />
              <Line type="monotone" dataKey="expenses" stroke="#FF8042" strokeWidth={2} name="Expenses" />
              <Line type="monotone" dataKey="net"      stroke="#0088FE" strokeWidth={2} name="Net" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Spending by Category */}
        <div className="chart-container">
          <h3>Spending by Category</h3>
          {spendingPieData.length > 0 ? (
            <div className="pie-chart-row">
              <ResponsiveContainer width={220} height={220}>
                <PieChart>
                  <Pie data={spendingPieData} cx="50%" cy="50%" outerRadius={90} dataKey="value" labelLine={false}>
                    {spendingPieData.map((entry) => (
                      <Cell key={entry.name} fill={getColor(entry.name)} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
                </PieChart>
              </ResponsiveContainer>
              <PieLegend data={spendingPieData} getColor={getColor} />
            </div>
          ) : (
            <p className="no-data">No expense data available</p>
          )}
        </div>

        {/* Income by Category */}
        <div className="chart-container">
          <h3>Income by Category</h3>
          {incomePieData.length > 0 ? (
            <div className="pie-chart-row">
              <ResponsiveContainer width={220} height={220}>
                <PieChart>
                  <Pie data={incomePieData} cx="50%" cy="50%" outerRadius={90} dataKey="value" labelLine={false}>
                    {incomePieData.map((entry) => (
                      <Cell key={entry.name} fill={getColor(entry.name)} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
                </PieChart>
              </ResponsiveContainer>
              <PieLegend data={incomePieData} getColor={getColor} />
            </div>
          ) : (
            <p className="no-data">No income data available</p>
          )}
        </div>

        {/* Top Vendors */}
        <div className="chart-container full-width">
          <h3>Top 10 Vendors by Spending</h3>
          {topVendorsData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={topVendorsData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="vendor" angle={-45} textAnchor="end" height={100} />
                <YAxis />
                <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
                <Bar dataKey="amount" fill="#FF8042" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="no-data">No vendor data available</p>
          )}
        </div>

        {/* Category Breakdown Table */}
        <div className="chart-container full-width">
          <h3>Spending Breakdown</h3>
          <div className="category-table">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Total</th>
                  <th>Average</th>
                  <th>Count</th>
                  <th>Percentage</th>
                </tr>
              </thead>
              <tbody>
                {analytics.spending_by_category?.map((cat, index) => (
                  <tr key={index}>
                    <td>{cat.category}</td>
                    <td>${cat.total.toFixed(2)}</td>
                    <td>${cat.average.toFixed(2)}</td>
                    <td>{cat.count}</td>
                    <td>{cat.percentage}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Weekly Averages */}
        <div className="chart-container">
          <h3>Weekly Averages</h3>
          <div className="trends-summary">
            <div className="trend-item">
              <span className="trend-label">Avg Weekly Income:</span>
              <span className="trend-value income">${analytics.trends.weekly_avg_income.toFixed(2)}</span>
            </div>
            <div className="trend-item">
              <span className="trend-label">Avg Weekly Expenses:</span>
              <span className="trend-value expenses">${analytics.trends.weekly_avg_expenses.toFixed(2)}</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default InsightsView;
