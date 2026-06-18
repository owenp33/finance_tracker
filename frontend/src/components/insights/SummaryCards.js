import React from 'react';

function SummaryCards({ summary }) {
  return (
    <div className="summary-cards">
      <div className="summary-card income">
        <h3>Total Income</h3>
        <div className="amount">${summary.total_income.toLocaleString()}</div>
        <div className="subtitle">{summary.transaction_count} transactions</div>
      </div>
      <div className="summary-card expenses">
        <h3>Total Expenses</h3>
        <div className="amount">${summary.total_expenses.toLocaleString()}</div>
        <div className="subtitle">Avg: ${summary.avg_transaction.toFixed(2)}</div>
      </div>
      <div className="summary-card net">
        <h3>Net Amount</h3>
        <div className="amount">${summary.net_amount.toLocaleString()}</div>
        <div className="subtitle">
          {summary.net_amount >= 0 ? '+ Positive' : '- Negative'}
        </div>
      </div>
    </div>
  );
}

export default SummaryCards;
