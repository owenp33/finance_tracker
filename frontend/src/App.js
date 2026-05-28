import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
import * as authAPI from './api/auth';
import * as accountsAPI from './api/accounts';
import * as transactionsAPI from './api/transactions';
import * as recurringAPI from './api/recurring';
import { useAccounts } from './hooks/useAccounts';
import { useTransactions } from './hooks/useTransactions';
import { useBudgets } from './hooks/useBudgets';
import { useUpcoming } from './hooks/useUpcoming';
import { useAnalytics } from './hooks/useAnalytics';
import { useUndoHistory } from './hooks/useUndoHistory';
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
  const { mode: undoMode, label: undoLabel, pushUndo, pushRedo, execute: executeUndo } = useUndoHistory();

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
    await Promise.all([loadAccounts(), loadTransactions(), loadBudgetProgress(), loadAnalytics()]);
  }, [loadAccounts, loadTransactions, loadBudgetProgress, loadAnalytics]);

  // ACTION HANDLERS ===========================================================

  const handleUndo = async () => {
    try { await executeUndo(); } catch (err) { setError(err.message); }
  };

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
    const prev = transactions.find(t => t.id === id);
    try {
      await transactionsAPI.updateTransaction(id, body);
      await refreshAll();
      if (prev) {
        const prevFields = { date: prev.date, vendor: prev.vendor, category: prev.category, amount: prev.amount, notes: prev.notes || '', account_id: prev.account_id };
        pushUndo(`edit "${prev.vendor}"`, async () => {
          await transactionsAPI.updateTransaction(id, prevFields);
          await refreshAll();
          pushRedo(async () => {
            await transactionsAPI.updateTransaction(id, body);
            await refreshAll();
          });
        });
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteTransaction = async (id) => {
    if (!window.confirm('Are you sure you want to delete this transaction?')) return;
    const tx = transactions.find(t => t.id === id);
    try {
      await transactionsAPI.deleteTransaction(id);
      await refreshAll();
      if (tx) {
        pushUndo(`delete "${tx.vendor}"`, async () => {
          const newTx = await transactionsAPI.addTransaction(tx.account_id, { date: tx.date, vendor: tx.vendor, category: tx.category, amount: tx.amount, notes: tx.notes || '', is_transfer: tx.is_transfer });
          await refreshAll();
          if (newTx?.id) {
            pushRedo(async () => {
              await transactionsAPI.deleteTransaction(newTx.id);
              await refreshAll();
            });
          }
        });
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleToggleTransfer = async (id) => {
    try {
      await transactionsAPI.toggleTransfer(id);
      await refreshAll();
      pushUndo('toggle transfer', async () => {
        await transactionsAPI.toggleTransfer(id);
        await refreshAll();
        pushRedo(async () => {
          await transactionsAPI.toggleTransfer(id);
          await refreshAll();
        });
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const handleToggleTransferMany = async (ids) => {
    try {
      await Promise.all(ids.map(id => transactionsAPI.toggleTransfer(id)));
      await refreshAll();
      pushUndo(`toggle ${ids.length} transfer${ids.length !== 1 ? 's' : ''}`, async () => {
        await Promise.all(ids.map(id => transactionsAPI.toggleTransfer(id)));
        await refreshAll();
        pushRedo(async () => {
          await Promise.all(ids.map(id => transactionsAPI.toggleTransfer(id)));
          await refreshAll();
        });
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteManyTransactions = async (ids) => {
    if (!window.confirm(`Delete ${ids.length} transaction${ids.length !== 1 ? 's' : ''}?`)) return;
    const txs = transactions.filter(t => ids.includes(t.id));
    try {
      await Promise.all(ids.map(id => transactionsAPI.deleteTransaction(id)));
      await refreshAll();
      if (txs.length > 0) {
        pushUndo(`delete ${txs.length} transaction${txs.length !== 1 ? 's' : ''}`, async () => {
          const newTxs = await Promise.all(txs.map(tx => transactionsAPI.addTransaction(tx.account_id, { date: tx.date, vendor: tx.vendor, category: tx.category, amount: tx.amount, notes: tx.notes || '', is_transfer: tx.is_transfer })));
          await refreshAll();
          const newIds = newTxs.filter(Boolean).map(t => t.id);
          if (newIds.length > 0) {
            pushRedo(async () => {
              await Promise.all(newIds.map(id => transactionsAPI.deleteTransaction(id)));
              await refreshAll();
            });
          }
        });
      }
    } catch (err) {
      setError(err.message);
    }
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
      await Promise.all([loadAllRecurring(accounts), loadUpcoming(accounts)]);
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
            onToggleTransfer={handleToggleTransfer}
            onToggleTransferMany={handleToggleTransferMany}
            onImportDone={refreshAll}
            onCreateAccount={handleCreateAccount}
            onEditAccount={handleEditAccount}
            onDeleteAccount={handleDeleteAccount}
            undoMode={undoMode}
            undoLabel={undoLabel}
            onUndo={handleUndo}
          />
        )}
        {view === 'budgeting' && (
          <BudgetingView
            transactions={transactions}
            onBudgetChange={loadBudgetProgress}
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
