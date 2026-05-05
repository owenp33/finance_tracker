import React from 'react';
import TransactionList from './TransactionList';
import BudgetProgressBar from './BudgetProgressBar';
import UpcomingList from './UpcomingList';

const RECENT_LIMIT = 5;

function DashboardView({ analytics, transactions, budgetData, upcoming, onNavigate }) {
  const stats = analytics?.summary
    ? {
        totalTransactions: analytics.summary.transaction_count || 0,
        totalIncome:       analytics.summary.total_income     || 0,
        totalExpenses:     analytics.summary.total_expenses   || 0,
        netAmount:         analytics.summary.net_amount       || 0,
      }
    : { totalTransactions: 0, totalIncome: 0, totalExpenses: 0, netAmount: 0 };

  const recentTransactions = transactions.slice(0, RECENT_LIMIT);

  return (
    <div className="dashboard-view">

      {/* Summary stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <h3>Total Transactions</h3>
          <div className="value">{stats.totalTransactions}</div>
        </div>
        <div className="stat-card">
          <h3>Total Income</h3>
          <div className="value green">${stats.totalIncome.toFixed(2)}</div>
        </div>
        <div className="stat-card">
          <h3>Total Expenses</h3>
          <div className="value red">${stats.totalExpenses.toFixed(2)}</div>
        </div>
        <div className="stat-card">
          <h3>Net Amount</h3>
          <div className="value">${stats.netAmount.toFixed(2)}</div>
        </div>
      </div>

      {/* Two-column section: spending vs budget + recent transactions */}
      <div className="dashboard-columns">
        <div className="dashboard-col">
          <div className="section-header">
            <h3>Spending vs Budget</h3>
            <button className="link-btn" onClick={() => onNavigate('budgeting')}>
              Manage →
            </button>
          </div>
          {budgetData?.length > 0 ? (
            <div className="budget-progress-list">
              {budgetData.map(item => (
                <BudgetProgressBar key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <p className="no-data">No budgets set for this period.</p>
          )}
        </div>

        <div className="dashboard-col">
          <div className="section-header">
            <h3>Recent Transactions</h3>
            <button className="link-btn" onClick={() => onNavigate('transactions')}>
              View all →
            </button>
          </div>
          <TransactionList transactions={recentTransactions} compact />
        </div>
      </div>

      {/* Upcoming recurring transactions */}
      <div className="upcoming-section">
        <h3>Due This Week</h3>
        <UpcomingList items={upcoming} />
      </div>

    </div>
  );
}

export default DashboardView;
