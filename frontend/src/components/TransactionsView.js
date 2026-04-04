import { useState, useRef, useEffect } from 'react';
import TransactionForm from './TransactionForm';
import TransactionList from './TransactionList';

function TransactionsView({ transactions, accounts, onAdd, onDelete, onImportCSV, showForm, onToggleForm }) {
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleAccount = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const clearFilter = () => setSelectedIds(new Set());

  const filtered = selectedIds.size > 0
    ? transactions.filter(t => selectedIds.has(t.account_id))
    : transactions;

  const filterLabel = selectedIds.size === 0
    ? 'All Accounts'
    : selectedIds.size === 1
      ? accounts.find(a => selectedIds.has(a.id))?.account_name
      : `${selectedIds.size} accounts`;

  return (
    <div className="transactions-view">
      <div className="view-header">
        <h2>Transactions</h2>
        <div className="view-header-actions">
          <div className="multi-select-dropdown" ref={dropdownRef}>
            <button
              className="dropdown-trigger"
              onClick={() => setDropdownOpen(o => !o)}
              type="button"
            >
              <span>{filterLabel}</span>
              <span className="dropdown-arrow">{dropdownOpen ? '▲' : '▼'}</span>
            </button>
            {dropdownOpen && (
              <div className="dropdown-menu">
                <div className="dropdown-header">
                  <span>Filter by account</span>
                  {selectedIds.size > 0 && (
                    <button className="dropdown-clear" onClick={clearFilter}>Clear</button>
                  )}
                </div>
                {accounts.map(a => (
                  <label key={a.id} className="dropdown-option">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(a.id)}
                      onChange={() => toggleAccount(a.id)}
                    />
                    <span>{a.account_name}</span>
                    <span className="dropdown-option-balance">
                      ${a.balance?.toFixed(2) || '0.00'}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <button className="btn btn-secondary" onClick={onImportCSV}>Import CSV</button>
        </div>
      </div>

      <div className="transactions-header">
        <h2>{filterLabel} <span className="count-badge">{filtered.length}</span></h2>
        <button className="btn btn-primary" onClick={onToggleForm}>
          {showForm ? 'Cancel' : '+ Add Transaction'}
        </button>
      </div>

      {showForm && (
        <TransactionForm onSubmit={onAdd} onCancel={onToggleForm} accounts={accounts} />
      )}
      <TransactionList transactions={filtered} onDelete={onDelete} showAll={true} />
    </div>
  );
}

export default TransactionsView;
