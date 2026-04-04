import React from 'react';
import TransactionForm from './TransactionForm';
import TransactionList from './TransactionList';

function TransactionsView({ transactions, onAdd, onDelete, onImportCSV, showForm, onToggleForm }) {
  return (
    <div className="transactions-view">
      <div className="view-header">
        <h2>Transactions</h2>
        <button className="secondary-btn" onClick={onImportCSV}>
          Import CSV
        </button>
      </div>
      <div className="transactions-header">
        <h2>All Transactions</h2>
        <button onClick={onToggleForm} className="add-btn">
          {showForm ? 'Cancel' : '+ Add Transaction'}
        </button>
      </div>
      {showForm && (
        <TransactionForm
          onSubmit={onAdd}
          onCancel={onToggleForm}
        />
      )}
      <TransactionList
        transactions={transactions}
        onDelete={onDelete}
        showAll={true}
      />
    </div>
  );
}

export default TransactionsView;
