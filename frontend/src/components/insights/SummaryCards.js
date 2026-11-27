import React from 'react';
import { formatDollars } from '../../utils/money';

function SummaryCards({ summary }) {
  return (
    <div className="summary-cards">
      <div className="summary-card income">
        <h3>Total Income</h3>
        <div className="amount">{formatDollars(summary.total_income)}</div>
        <div className="subtitle">{summary.transaction_count} transactions</div>
      </div>
      <div className="summary-card expenses">
        <h3>Total Expenses</h3>
        <div className="amount">{formatDollars(summary.total_expenses)}</div>
        <div className="subtitle">Avg: {formatDollars(summary.avg_transaction)}</div>
      </div>
      <div className="summary-card net">
        <h3>Net Amount</h3>
        <div className="amount">{formatDollars(summary.net_amount)}</div>
        <div className="subtitle">
          {summary.net_amount >= 0 ? '+ Positive' : '- Negative'}
        </div>
      </div>
    </div>
  );
}

export default SummaryCards;
