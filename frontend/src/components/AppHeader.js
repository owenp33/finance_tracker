import React from 'react';

const NAV_LABELS = {
  dashboard: '📊 Dashboard',
  transactions: '💳 Transactions',
  analytics: '📈 Analytics',
  recurring: '🔄 Recurring',
};

function AppHeader({ user, accounts, selectedAccount, onSelectAccount, onCreateAccount, onLogout, view, onViewChange, error, onDismissError }) {
  return (
    <header className="App-header">
      <div className="header-content">
        <h1>💰 Money Tracker</h1>
        <div className="header-actions">
          <span>Welcome, {user?.username}!</span>
          <button onClick={onLogout} className="logout-btn">Logout</button>
        </div>
      </div>

      <div className="account-selector">
        <select
          value={selectedAccount || ''}
          onChange={(e) => onSelectAccount(parseInt(e.target.value))}
        >
          <option value="">Select Account</option>
          {accounts.map(account => (
            <option key={account.id} value={account.id}>
              {account.account_name} - Balance: ${account.balance?.toFixed(2) || '0.00'}
            </option>
          ))}
        </select>
        <button onClick={onCreateAccount} className="add-account-btn">
          + Add Account
        </button>
      </div>

      <nav className="view-nav">
        {Object.entries(NAV_LABELS).map(([key, label]) => (
          <button
            key={key}
            className={view === key ? 'active' : ''}
            onClick={() => onViewChange(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {error && (
        <div className="error-message">
          {error}
          <button onClick={onDismissError}>×</button>
        </div>
      )}
    </header>
  );
}

export default AppHeader;
