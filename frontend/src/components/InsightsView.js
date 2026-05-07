import React from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { useCategoryColors } from '../CategoryColorContext';

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

const InsightsView = ({ analytics }) => {
  const { getColor } = useCategoryColors();

  if (!analytics) {
    return <div className="analytics-loading">Loading analytics...</div>;
  }

  const spendingPieData = analytics.spending_by_category?.map(cat => ({
    name: cat.category,
    value: cat.total,
  })) || [];

  const incomePieData = analytics.income_by_category?.map(cat => ({
    name: cat.category,
    value: cat.total,
  })) || [];

  const monthlyTrendData = (analytics.monthly_summary?.map(month => ({
    month: month.month,
    income: month.income,
    expenses: month.expenses,
    net: month.net,
  })) || []).slice().reverse();

  const topVendorsData = analytics.top_vendors?.slice(0, 10) || [];

  return (
    <div className="analytics-dashboard">
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
            {analytics.summary.net_amount >= 0 ? '✓ Positive' : '⚠ Negative'}
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
              <Line type="monotone" dataKey="income" stroke="#00C49F" strokeWidth={2} name="Income" />
              <Line type="monotone" dataKey="expenses" stroke="#FF8042" strokeWidth={2} name="Expenses" />
              <Line type="monotone" dataKey="net" stroke="#0088FE" strokeWidth={2} name="Net" />
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
