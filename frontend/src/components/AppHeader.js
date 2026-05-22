import React from 'react';
import { LayoutDashboard, Receipt, Wallet, TrendingUp } from 'lucide-react';

const NAV_ITEMS = [
  { key: 'dashboard',    label: 'Dashboard',    Icon: LayoutDashboard },
  { key: 'transactions', label: 'Transactions', Icon: Receipt  },
  { key: 'budgeting',    label: 'Budgeting',    Icon: Wallet          },
  { key: 'insights',     label: 'Insights',     Icon: TrendingUp      },
];

function AppHeader({ user, onLogout, view, onViewChange, error, onDismissError }) {
  return (
    <header className="App-header">
      <div className="header-content">
        <h1>Personal Finance Dashboard</h1>
        <div className="header-actions">
          <span>Welcome, {user?.username}!</span>
          <button onClick={onLogout} className="logout-btn">Logout</button>
        </div>
      </div>

      <nav className="view-nav">
        {NAV_ITEMS.map(({ key, label, Icon }) => (
          <button
            key={key}
            className={view === key ? 'active' : ''}
            onClick={() => onViewChange(key)}
          >
            <Icon size={16} />
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
