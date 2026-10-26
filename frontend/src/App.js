import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
import * as authAPI from './api/auth';
import * as accountsAPI from './api/accounts';
import * as transactionsAPI from './api/transactions';
import * as recurringAPI from './api/recurring';
import { forEachInOrder } from './utils/sequence';
import { SESSION_EXPIRED_EVENT } from './api/client';
import { useAccounts } from './hooks/useAccounts';
import { useTransactions } from './hooks/useTransactions';
import { useBudgets } from './hooks/useBudgets';
import { useUpcoming } from './hooks/useUpcoming';
import { useAnalytics } from './hooks/useAnalytics';
import AuthScreen from './components/AuthScreen';
import AppHeader from './components/AppHeader';
import DashboardView from './components/DashboardView';
import TransactionsView from './components/TransactionsView';
import BudgetingView from './components/BudgetingView';
import InsightsView from './components/InsightsView';

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
  const { accounts, loadAccounts } = useAccounts({ setError });
  const { transactions, loadTransactions } = useTransactions({ setError });
  const { budgetData, loadBudgetProgress } = useBudgets({ setError });
  const { upcoming, loadUpcoming } = useUpcoming({ setError });
  const { analytics, loadAnalytics } = useAnalytics({ setError });
  // AUTH HANDLERS =============================================================

  const handleLogout = useCallback(() => {
    setToken(null);
    setUser(null);
    setIsAuthenticated(false);
    localStorage.removeItem('token');
  }, []);

  const startSession = (data) => {
    setToken(data.access_token);
    setUser(data.user);
    setIsAuthenticated(true);
    localStorage.setItem('token', data.access_token);
  };

  const handleLogin = async (username, password) => {
    try {
      const data = await authAPI.login(username, password);
      startSession(data);
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
      startSession(data);
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
    await Promise.all([loadAccounts(), loadTransactions(), loadBudgetProgress(), loadAnalytics()]);
  }, [loadAccounts, loadTransactions, loadBudgetProgress, loadAnalytics]);

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

  const handleToggleTransfer = async (id) => {
    try {
      await transactionsAPI.toggleTransfer(id);
      await refreshAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const handlePairTransfer = async (txId, toAccountId) => {
    try {
      await transactionsAPI.pairTransfer(txId, toAccountId);
      await refreshAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleBreakTransferLink = async (txId) => {
    try {
      await transactionsAPI.breakTransferLink(txId);
      await refreshAll();
    } catch (err) {
      setError(err.message);
    }
  };

  // Bulk actions send one request at a time (see forEachInOrder) and refresh even after a
  // failure, since the steps before it were applied
  const handleDeleteTransferBulk = async (ids) => {
    try {
      await forEachInOrder(ids, id => transactionsAPI.deleteTransaction(id));
    } catch (err) {
      setError(err.message);
    }
    await refreshAll();
  };

  const handleToggleTransferMany = async (ids) => {
    try {
      await forEachInOrder(ids, id => transactionsAPI.toggleTransfer(id));
    } catch (err) {
      setError(err.message);
    }
    await refreshAll();
  };

  const handleDeleteManyTransactions = async (ids) => {
    if (!window.confirm(`Delete ${ids.length} transaction${ids.length !== 1 ? 's' : ''}?`)) return;
    try {
      await forEachInOrder(ids, id => transactionsAPI.deleteTransaction(id));
    } catch (err) {
      setError(err.message);
    }
    await refreshAll();
  };

  const handleAddRecurring = async (formData) => {
    const { account_id, ...rest } = formData;
    try {
      await recurringAPI.addRecurring(account_id, rest);
      await Promise.all([loadAllRecurring(accounts), loadUpcoming(accounts), refreshAll()]);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleEditRecurring = async (id, fields) => {
    try {
      await recurringAPI.updateRecurring(id, fields);
      await Promise.all([loadAllRecurring(accounts), loadUpcoming(accounts), refreshAll()]);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteRecurring = async (id) => {
    try {
      await recurringAPI.deleteRecurring(id);
      await Promise.all([loadAllRecurring(accounts), loadUpcoming(accounts)]);
    } catch (err) {
      setError(err.message);
    }
  };

  // One request per transaction, in order: each link renumbers the series. refreshAll reloads the
  // accounts, which reloads the templates and their suggestion counts.
  const handleLinkToRecurring = async (recurringId, transactionIds) => {
    try {
      await forEachInOrder(transactionIds, id => recurringAPI.linkToRecurring(recurringId, id));
    } catch (err) {
      setError(err.message);
    }
    await refreshAll();
  };

  // Keeps the transaction; the series shrinks and renumbers
  const handleUnlinkFromRecurring = async (recurringId, transactionId) => {
    try {
      await recurringAPI.unlinkFromRecurring(recurringId, transactionId);
    } catch (err) {
      setError(err.message);
    }
    await refreshAll();
  };

  const handleDismissSuggestion = async (recurringId, transactionId) => {
    try {
      await recurringAPI.dismissSuggestion(recurringId, transactionId);
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

  // Resolves to whether the save worked, so the edit form can stay open after an error
  const handleEditAccount = async (id, fields) => {
    try {
      await accountsAPI.updateAccount(id, fields);
      await loadAccounts();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  };

  // Budgets decide which transactions the server marks over budget, so reload both. Stable
  // (useCallback), since useBudgetData depends on it.
  const handleBudgetChange = useCallback(async () => {
    await Promise.all([loadBudgetProgress(), loadTransactions()]);
  }, [loadBudgetProgress, loadTransactions]);

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

  // A protected request found the login missing, expired, or invalid: back to the login screen,
  // showing the server's message there
  useEffect(() => {
    const onSessionExpired = (e) => {
      handleLogout();
      setError(e.detail);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
  }, [handleLogout]);

  useEffect(() => {
    if (isAuthenticated) {
      loadAccounts();
      loadTransactions();
      loadBudgetProgress();
      loadAnalytics();
    }
  }, [isAuthenticated, loadAccounts, loadTransactions, loadBudgetProgress, loadAnalytics]);

  useEffect(() => {
    loadAllRecurring(accounts);
    loadUpcoming(accounts);
  }, [accounts, loadAllRecurring, loadUpcoming]);

  // RENDER ====================================================================

  if (loading) {
    return (
      <div className="App">
        <div className="loading-screen">
          <h1>Personal Finance Dashboard</h1>
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
            upcoming={upcoming}
            onNavigate={setView}
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
            onDeleteMany={handleDeleteManyTransactions}
            onEditRecurring={handleEditRecurring}
            onDeleteRecurring={handleDeleteRecurring}
            onLinkToRecurring={handleLinkToRecurring}
            onDismissSuggestion={handleDismissSuggestion}
            onUnlinkFromRecurring={handleUnlinkFromRecurring}
            onToggleTransfer={handleToggleTransfer}
            onToggleTransferMany={handleToggleTransferMany}
            onPairTransfer={handlePairTransfer}
            onBreakTransferLink={handleBreakTransferLink}
            onDeleteTransferBulk={handleDeleteTransferBulk}
            onImportDone={refreshAll}
            onCreateAccount={handleCreateAccount}
            onEditAccount={handleEditAccount}
            onDeleteAccount={handleDeleteAccount}
          />
        )}
        {view === 'budgeting' && (
          <BudgetingView
            transactions={transactions}
            onBudgetChange={handleBudgetChange}
          />
        )}
        {view === 'insights' && (
          <InsightsView transactions={transactions} accounts={accounts} />
        )}
      </main>
    </div>
  );
}

export default App;
