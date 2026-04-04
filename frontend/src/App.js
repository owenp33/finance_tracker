import React, { useState, useEffect } from 'react';
import './App.css';
import { fetchAPI, uploadFile } from './api/client';
import AuthScreen from './components/AuthScreen';
import AppHeader from './components/AppHeader';
import DashboardView from './components/DashboardView';
import TransactionsView from './components/TransactionsView';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import RecurringView from './components/RecurringView';
import CSVImportModal from './components/CSVImportModal';

function App() {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [token, setToken] = useState(() => localStorage.getItem('token') || null);
  const [user, setUser] = useState(null);

  // Data state
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
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
        loadAnalytics(data.accounts[0].id);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const loadTransactions = async (accountId) => {
    try {
      const data = await fetchAPI(`/api/accounts/${accountId}/transactions`);
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
      loadTransactions(accountId),
      loadAccounts(),
      loadAnalytics(accountId),
    ]);
  };

  // ACTION HANDLERS ===========================================================

  const handleAddTransaction = async (formData) => {
    try {
      await fetchAPI(`/api/accounts/${selectedAccount}/transactions`, {
        method: 'POST',
        body: JSON.stringify(formData),
      });
      await refreshAccountData(selectedAccount);
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
      await refreshAccountData(selectedAccount);
      alert('Transaction deleted successfully!');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreateAccount = async (accountId, accountName) => {
    try {
      await fetchAPI('/api/accounts', {
        method: 'POST',
        body: JSON.stringify({ account_id: accountId, account_name: accountName }),
      });
      await loadAccounts();
      alert('Account created successfully!');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCSVImport = async (file) => {
    try {
      setLoading(true);
      const data = await uploadFile(`/api/csv/accounts/${selectedAccount}/import-csv`, file);
      await refreshAccountData(selectedAccount);
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
    if (isAuthenticated) loadAccounts();
  }, [isAuthenticated]);

  useEffect(() => {
    if (selectedAccount) {
      loadTransactions(selectedAccount);
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

  return (
    <div className="App">
      <AppHeader
        user={user}
        accounts={accounts}
        selectedAccount={selectedAccount}
        onSelectAccount={setSelectedAccount}
        onCreateAccount={() => {
          const accountId = prompt('Enter account ID:');
          const accountName = prompt('Enter account name:');
          if (accountId && accountName) handleCreateAccount(accountId, accountName);
        }}
        onLogout={handleLogout}
        view={view}
        onViewChange={setView}
        error={error}
        onDismissError={() => setError(null)}
      />

      <main className="App-main">
        {selectedAccount ? (
          <>
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
                onAdd={handleAddTransaction}
                onDelete={handleDeleteTransaction}
                onImportCSV={() => setShowCSVImport(true)}
                showForm={showTransactionForm}
                onToggleForm={() => setShowTransactionForm(f => !f)}
              />
            )}
            {view === 'analytics' && <AnalyticsDashboard analytics={analytics} />}
            {view === 'recurring' && (
              <RecurringView recurringTransactions={recurringTransactions} />
            )}
          </>
        ) : (
          <div className="no-account-message">
            <h2>No Account Selected</h2>
            <p>Please select an account or create a new one to get started.</p>
          </div>
        )}

        {showCSVImport && (
          <CSVImportModal
            onImport={handleCSVImport}
            onClose={() => setShowCSVImport(false)}
            loading={loading}
          />
        )}
      </main>
    </div>
  );
}

export default App;
