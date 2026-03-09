import React from 'react';

function TransactionList({ transactions, onDelete, showAll = false }) {
  if (!transactions || transactions.length === 0) {
    return <p className="no-data">No transactions found</p>;
  }

  return (
    <div className="transaction-list">
      {transactions.map(transaction => (
        <div key={transaction.id} className="transaction-item">
          <div className="transaction-info">
            <strong>{transaction.vendor}</strong>
            <span>{transaction.category} • {transaction.date}</span>
            {transaction.notes && <small>{transaction.notes}</small>}
          </div>
          <div className="transaction-right">
            <div className={`transaction-amount ${transaction.amount >= 0 ? 'green' : 'red'}`}>
              {transaction.amount >= 0 ? '+' : ''}${Math.abs(transaction.amount).toFixed(2)}
            </div>
            {showAll && (
              <button
                onClick={() => onDelete(transaction.id)}
                className="delete-btn"
                title="Delete transaction"
              >
                🗑️
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default TransactionList;