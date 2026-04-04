import React, { useState, useEffect } from 'react';
import './App.css';
import { fetchAPI, uploadFile } from './api/client';
import AuthScreen from './components/AuthScreen';
import AppHeader from './components/AppHeader';
import DashboardView from './components/DashboardView';
import TransactionsView from './components/TransactionsView';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import RecurringView from './components/RecurringView';
import AccountsView from './components/AccountsView';
import CSVImportModal from './components/CSVImportModal';

function App() {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [token, setToken] = useState(() => localStorage.getItem('token') || null);
  const [user, setUser] = useState(null);

  // Data state
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null); // used only by analytics/recurring
  const [transactions, setTransactions] = useState([]);
  const [recurringTransactions, setRecurringTransactions] = useState([]);
  const [analytics, setAnalytics] = useState(null);

  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState('dashboard');
  const [showCSVImport, setShowCSVImport] = useState(false);
  const [showTransactionForm, setShowTransactionForm] = useState(false);

  // AUTH HANDLERS =============================================================

  const handleLogin = async (username, password) => {
    try {
      const data = await fetchAPI('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      const userData = typeof data.user === 'string' ? JSON.parse(data.user) : data.user;
      setToken(data.access_token);
      setUser(userData);
      setIsAuthenticated(true);
      localStorage.setItem('token', data.access_token);
      if (data.updates?.transactions_generated > 0) {
        alert(`Generated ${data.updates.transactions_generated} recurring transactions`);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRegister = async (username, email, password) => {
    try {
      const data = await fetchAPI('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, email, password }),
      });
      const userData = typeof data.user === 'object' ? data.user : JSON.parse(data.user);
      setToken(data.access_token);
      setUser(userData);
      setIsAuthenticated(true);
      localStorage.setItem('token', data.access_token);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    setIsAuthenticated(false);
    localStorage.removeItem('token');
    setAccounts([]);
    setSelectedAccount(null);
  };

  // DATA LOADERS ==============================================================

  const loadAccounts = async () => {
    try {
      const data = await fetchAPI('/api/accounts');
      setAccounts(data.accounts);
      if (data.accounts.length > 0 && !selectedAccount) {
        setSelectedAccount(data.accounts[0].id);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const loadTransactions = async () => {
    try {
      const data = await fetchAPI('/api/accounts/all-transactions');
      setTransactions(data.transactions);
    } catch (err) {
      setError(err.message);
    }
  };

  const loadRecurringTransactions = async (accountId) => {
    try {
      const data = await fetchAPI(`/api/accounts/${accountId}/recurring`);
      setRecurringTransactions(data.recurring);
    } catch (err) {
      setError(err.message);
    }
  };

  const loadAnalytics = async (accountId) => {
    if (!accountId) return;
    try {
      const data = await fetchAPI(`/api/analytics/accounts/${accountId}/analytics`);
      setAnalytics(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const refreshAccountData = async (accountId) => {
    await Promise.all([
      loadTransactions(),
      loadAccounts(),
      loadAnalytics(accountId || selectedAccount),
    ]);
  };

  // ACTION HANDLERS ===========================================================

  const handleAddTransaction = async (formData) => {
    const { account_id, ...rest } = formData;
    try {
      await fetchAPI(`/api/accounts/${account_id}/transactions`, {
        method: 'POST',
        body: JSON.stringify(rest),
      });
      await refreshAccountData(account_id);
      setShowTransactionForm(false);
      alert('Transaction added successfully!');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteTransaction = async (transactionId) => {
    if (!window.confirm('Are you sure you want to delete this transaction?')) return;
    try {
      await fetchAPI(`/api/transactions/${transactionId}`, { method: 'DELETE' });
      await refreshAccountData();
      alert('Transaction deleted successfully!');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreateAccount = async (accountId, accountName) => {
    try {
      const data = await fetchAPI('/api/accounts', {
        method: 'POST',
        body: JSON.stringify({ account_id: accountId, account_name: accountName }),
      });
      await loadAccounts();
      return data.account;
    } catch (err) {
      setError(err.message);
      return null;
    }
  };

  const handleEditAccount = async (id, fields) => {
    try {
      await fetchAPI(`/api/accounts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(fields),
      });
      await loadAccounts();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteAccount = async (id) => {
    try {
      await fetchAPI(`/api/accounts/${id}`, { method: 'DELETE' });
      await Promise.all([loadAccounts(), loadTransactions()]);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCSVImport = async (file, accountId) => {
    try {
      setLoading(true);
      const data = await uploadFile(`/api/csv/accounts/${accountId}/import-csv`, file);
      await refreshAccountData(accountId);
      setShowCSVImport(false);
      alert(`${data.message}\nNew balance: $${data.new_balance.toFixed(2)}`);
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // EFFECTS ===================================================================

  useEffect(() => {
    const checkAuth = async () => {
      if (token) {
        try {
          const data = await fetchAPI('/api/auth/me');
          setUser(data.user);
          setIsAuthenticated(true);
        } catch {
          handleLogout();
        }
      }
      setLoading(false);
    };
    checkAuth();
  }, [token]);

  useEffect(() => {
    if (isAuthenticated) {
      loadAccounts();
      loadTransactions();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (selectedAccount) {
      loadRecurringTransactions(selectedAccount);
      loadAnalytics(selectedAccount);
    }
  }, [selectedAccount]);

  // RENDER ====================================================================

  if (loading) {
    return (
      <div className="App">
        <div className="loading-screen">
          <h1>💰 Money Tracker</h1>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthScreen onLogin={handleLogin} onRegister={handleRegister} error={error} />;
  }

  // Inline account picker for views that still need a single account (analytics/recurring)
  const AccountPicker = () => (
    <div className="account-picker-inline">
      <label>Account: </label>
      <select value={selectedAccount || ''} onChange={e => setSelectedAccount(parseInt(e.target.value))}>
        <option value="">— select —</option>
        {accounts.map(a => (
          <option key={a.id} value={a.id}>{a.account_name}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="App">
      <AppHeader
        user={user}
        onLogout={handleLogout}
        view={view}
        onViewChange={setView}
        error={error}
        onDismissError={() => setError(null)}
      />

      <main className="App-main">
        {view === 'dashboard' && (
          <DashboardView
            analytics={analytics}
            transactions={transactions}
            onDeleteTransaction={handleDeleteTransaction}
          />
        )}
        {view === 'transactions' && (
          <TransactionsView
            transactions={transactions}
            accounts={accounts}
            onAdd={handleAddTransaction}
            onDelete={handleDeleteTransaction}
            onImportCSV={() => setShowCSVImport(true)}
            showForm={showTransactionForm}
            onToggleForm={() => setShowTransactionForm(f => !f)}
          />
        )}
        {view === 'analytics' && (
          <>
            <AccountPicker />
            <AnalyticsDashboard analytics={analytics} />
          </>
        )}
        {view === 'recurring' && (
          <>
            <AccountPicker />
            <RecurringView recurringTransactions={recurringTransactions} />
          </>
        )}
        {view === 'accounts' && (
          <AccountsView
            accounts={accounts}
            onCreateAccount={handleCreateAccount}
            onEditAccount={handleEditAccount}
            onDeleteAccount={handleDeleteAccount}
          />
        )}

        {showCSVImport && (
          <CSVImportModal
            onImport={handleCSVImport}
            onClose={() => setShowCSVImport(false)}
            onCreateAccount={handleCreateAccount}
            accounts={accounts}
            loading={loading}
          />
        )}
      </main>
    </div>
  );
}

export default App;
