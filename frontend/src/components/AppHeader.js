import React from 'react';

const NAV_LABELS = {
  dashboard: '📊 Dashboard',
  transactions: '💳 Transactions',
  budgeting: '💰 Budgeting',
  insights: '📈 Insights',
};

function AppHeader({ user, onLogout, view, onViewChange, error, onDismissError }) {
  return (
    <header className="App-header">
      <div className="header-content">
        <h1>💲 Personal Finance Dashboard 💵</h1>
        <div className="header-actions">
          <span>Welcome, {user?.username}!</span>
          <button onClick={onLogout} className="logout-btn">Logout</button>
        </div>
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
