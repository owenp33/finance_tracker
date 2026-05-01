import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
import * as authAPI from './api/auth';
import * as accountsAPI from './api/accounts';
import * as transactionsAPI from './api/transactions';
import * as recurringAPI from './api/recurring';
import { useAccounts } from './hooks/useAccounts';
import { useTransactions } from './hooks/useTransactions';
import { useBudgets } from './hooks/useBudgets';
import { useAnalytics } from './hooks/useAnalytics';
import AuthScreen from './components/AuthScreen';
import AppHeader from './components/AppHeader';
import DashboardView from './components/DashboardView';
import TransactionsView from './components/TransactionsView';
import AnalyticsDashboard from './components/AnalyticsDashboard';

function App() {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [token, setToken] = useState(() => localStorage.getItem('token') || null);
  const [user, setUser] = useState(null);

  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState('dashboard');

  // Recurring state (all accounts)
  const [recurringTransactions, setRecurringTransactions] = useState([]);

  // Domain hooks
  const { accounts, selectedAccount, loadAccounts } = useAccounts({ setError });
  const { transactions, loadTransactions } = useTransactions({ setError });
  const { budgetData, loadBudgetProgress } = useBudgets({ setError });
  const { analytics, loadAnalytics } = useAnalytics({ setError });

  // AUTH HANDLERS =============================================================

  const handleLogout = useCallback(() => {
    setToken(null);
    setUser(null);
    setIsAuthenticated(false);
    localStorage.removeItem('token');
  }, []);

  const handleLogin = async (username, password) => {
    try {
      const data = await authAPI.login(username, password);
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
      const data = await authAPI.register(username, email, password);
      const userData = typeof data.user === 'object' ? data.user : JSON.parse(data.user);
      setToken(data.access_token);
      setUser(userData);
      setIsAuthenticated(true);
      localStorage.setItem('token', data.access_token);
    } catch (err) {
      setError(err.message);
    }
  };

  // RECURRING =================================================================

  const loadAllRecurring = useCallback(async (accountList) => {
    if (!accountList || accountList.length === 0) return;
    try {
      const results = await Promise.all(
        accountList.map(a => recurringAPI.getAccountRecurring(a.id))
      );
      setRecurringTransactions(results.flat());
    } catch (err) {
      setError(err.message);
    }
  }, [setError]);

  // REFRESH ===================================================================

  const refreshAll = useCallback(async () => {
    await Promise.all([loadAccounts(), loadTransactions(), loadBudgetProgress()]);
  }, [loadAccounts, loadTransactions, loadBudgetProgress]);

  // ACTION HANDLERS ===========================================================

  const handleAddTransaction = async (formData) => {
    const { account_id, ...rest } = formData;
    try {
      await transactionsAPI.addTransaction(account_id, rest);
      await refreshAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleEditTransaction = async (id, body) => {
    try {
      await transactionsAPI.updateTransaction(id, body);
      await refreshAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteTransaction = async (id) => {
    if (!window.confirm('Are you sure you want to delete this transaction?')) return;
    try {
      await transactionsAPI.deleteTransaction(id);
      await refreshAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAddRecurring = async (formData) => {
    const { account_id, ...rest } = formData;
    try {
      await recurringAPI.addRecurring(account_id, rest);
      await loadAllRecurring(accounts);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleEditRecurring = async (id, fields) => {
    try {
      await recurringAPI.updateRecurring(id, fields);
      await loadAllRecurring(accounts);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteRecurring = async (id) => {
    try {
      await recurringAPI.deleteRecurring(id);
      await loadAllRecurring(accounts);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreateAccount = async (accountId, accountName) => {
    try {
      const account = await accountsAPI.createAccount(accountId, accountName);
      await loadAccounts();
      return account;
    } catch (err) {
      setError(err.message);
      return null;
    }
  };

  const handleEditAccount = async (id, fields) => {
    try {
      await accountsAPI.updateAccount(id, fields);
      await loadAccounts();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteAccount = async (id) => {
    try {
      await accountsAPI.deleteAccount(id);
      await Promise.all([loadAccounts(), loadTransactions()]);
    } catch (err) {
      setError(err.message);
    }
  };

  // EFFECTS ===================================================================

  useEffect(() => {
    const checkAuth = async () => {
      if (token) {
        try {
          const data = await authAPI.me();
          setUser(data.user);
          setIsAuthenticated(true);
        } catch {
          handleLogout();
        }
      }
      setLoading(false);
    };
    checkAuth();
  }, [token, handleLogout]);

  useEffect(() => {
    if (isAuthenticated) {
      loadAccounts();
      loadTransactions();
      loadBudgetProgress();
    }
  }, [isAuthenticated, loadAccounts, loadTransactions, loadBudgetProgress]);

  useEffect(() => {
    if (selectedAccount) {
      loadAnalytics(selectedAccount);
    }
  }, [selectedAccount, loadAnalytics]);

  useEffect(() => {
    loadAllRecurring(accounts);
  }, [accounts, loadAllRecurring]);

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
            budgetData={budgetData}
            onNavigate={setView}
            onDeleteTransaction={handleDeleteTransaction}
          />
        )}
        {view === 'transactions' && (
          <TransactionsView
            transactions={transactions}
            accounts={accounts}
            recurringTransactions={recurringTransactions}
            onAdd={handleAddTransaction}
            onAddRecurring={handleAddRecurring}
            onEdit={handleEditTransaction}
            onDelete={handleDeleteTransaction}
            onEditRecurring={handleEditRecurring}
            onDeleteRecurring={handleDeleteRecurring}
            onImportDone={refreshAll}
          />
        )}
        {view === 'budgeting' && (
          <div className="placeholder-view">
            <h2>Budgeting</h2>
            <p>Set allocations, track spending by category, and manage rollovers.</p>
          </div>
        )}
        {view === 'insights' && (
          <AnalyticsDashboard analytics={analytics} />
        )}
      </main>
    </div>
  );
}

export default App;
