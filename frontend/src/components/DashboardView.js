import React from 'react';
import TransactionList from './TransactionList';

function DashboardView({ analytics, transactions, onDeleteTransaction }) {
  const stats = analytics?.summary ? {
    totalTransactions: analytics.summary.transaction_count || 0,
    totalIncome: analytics.summary.total_income || 0,
    totalExpenses: analytics.summary.total_expenses || 0,
    netAmount: analytics.summary.net_amount || 0,
  } : { totalTransactions: 0, totalIncome: 0, totalExpenses: 0, netAmount: 0 };

  return (
    <div className="dashboard-view">
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

      {analytics?.spending_by_category?.length > 0 && (
        <div className="category-section">
          <h3>Spending by Category</h3>
          <div className="category-list">
            {analytics.spending_by_category.map((item, index) => (
              <div key={index} className="category-item">
                <span>{item.category}</span>
                <span className="red">
                  ${item.total.toFixed(2)} ({item.percentage}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="recent-transactions-section">
        <h3>Recent Transactions</h3>
        <TransactionList
          transactions={transactions.slice(0, 10)}
          onDelete={onDeleteTransaction}
        />
      </div>
    </div>
  );
}

export default DashboardView;