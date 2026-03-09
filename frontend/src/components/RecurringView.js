import React from 'react';

function RecurringView({ recurringTransactions }) {
  return (
    <div className="recurring-view">
      <h2>Recurring Transactions</h2>
      <div className="recurring-list">
        {recurringTransactions.length === 0 ? (
          <p>No recurring transactions found</p>
        ) : (
          recurringTransactions.map(recurring => (
            <div key={recurring.id} className="recurring-item">
              <div className="recurring-info">
                <strong>{recurring.vendor}</strong>
                <span>{recurring.category}</span>
                <span>Every {recurring.frequency} days</span>
              </div>
              <div className="recurring-amount">
                ${Math.abs(recurring.amount).toFixed(2)}
              </div>
              <div className="recurring-dates">
                <small>Next: {recurring.next_date}</small>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default RecurringView;