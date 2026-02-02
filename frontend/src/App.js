import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [token, setToken] = useState(() => {
    return localStorage.getItem('token') || null;
  });
  const [user, setUser] = useState(null);
  
  // App state
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [recurringTransactions, setRecurringTransactions] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  
  // UI state
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState('dashboard'); // dashboard, transactions, analytics, recurring

  // const [showCSVImport, setShowCSVImport] = useState(false);
  // const [csvFile, setCSVFile] = useState(null);
  // const [csvImporting, setCSVImporting] = useState(false);
  
  // Form state
  const [showTransactionForm, setShowTransactionForm] = useState(false);
  const [transactionFormData, setTransactionFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    vendor: '',
    category: '',
    amount: '',
    notes: ''
  });

  const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';
  
  // Utility function for API calls
  const fetchAPI = async (endpoint, options = {}) => {
    const tokenTemp = localStorage.getItem('token'); // Add this line
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const skipAuth = endpoint === '/login' || endpoint === '/register'; 
    if (tokenTemp && !skipAuth) {
      headers['Authorization'] = `Bearer ${tokenTemp}`;
    }

    console.log('Request endpoint: ', endpoint);
    console.log('Request body: ', options.body);
    console.log('Request method: ', options.method || 'GET');

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.log('Error status: ', response.status);
      console.log('Error data: ', errorData);
      throw new Error(errorData.error || 'Request failed');
    }

    return response.json();
  };

  // Authentication functions
  const handleLogin = async (username, password) => {
    try {
      const data = await fetchAPI('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });

      console.log('Data: ', data);
      setToken(data.access_token);
      setUser(data.user);
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

      setToken(data.access_token);
      setUser(data.user);
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

  // Load user accounts
  const loadAccounts = async () => {
    try {
      const data = await fetchAPI('/api/accounts');
      setAccounts(data.accounts);
      
      if (data.accounts.length > 0 && !selectedAccount) {
        setSelectedAccount(data.accounts[0].id);
        loadAnalytics(data.accounts[0].id)
      }
    } catch (err) {
      setError(err.message);
    }
  };

  // Load transactions for selected account
  const loadTransactions = async (accountId) => {
    try {
      const data = await fetchAPI(`/api/accounts/${accountId}/transactions`);
      setTransactions(data.transactions);
    } catch (err) {
      setError(err.message);
    }
  };

  // Load recurring transactions
  const loadRecurringTransactions = async (accountId) => {
    try {
      const data = await fetchAPI(`/api/accounts/${accountId}/recurring`);
      setRecurringTransactions(data.recurring);
    } catch (err) {
      setError(err.message);
    }
  };

  // Load analytics
const loadAnalytics = async (accountId) => {
  if (!accountId) return;
  
  try {
    const data = await fetchAPI(`/api/accounts/${accountId}/analytics`);
    setAnalytics(data);
  } catch (err) {
    console.error('Failed to load analytics:', err);
    setError(err.message);
  }
};

  // Add transaction
  const handleAddTransaction = async (e) => {
    e.preventDefault();
    
    try {
      const data = await fetchAPI(`/api/accounts/${selectedAccount}/transactions`, {
        method: 'POST',
        body: JSON.stringify(transactionFormData),
      });


  
      // Refresh transactions
      await Promise.all([
        loadTransactions(selectedAccount),
        loadAccounts(),
        loadAnalytics(selectedAccount)
      ])
      
      // Reset form
      setTransactionFormData({
        date: new Date().toISOString().split('T')[0],
        vendor: '',
        category: '',
        amount: '',
        notes: ''
      });
      
      setShowTransactionForm(false);
      alert('Transaction added successfully!');
    } catch (err) {
      setError(err.message);
    }
  };

  // Delete transaction
  const handleDeleteTransaction = async (transactionId) => {
    if (!window.confirm('Are you sure you want to delete this transaction?')) {
      return;
    }

    try {
      await fetchAPI(`/api/transactions/${transactionId}`, {
        method: 'DELETE',
      });

      // Refresh transactions
      await Promise.all ([
        loadTransactions(selectedAccount),
        loadAccounts(),
        loadAnalytics(selectedAccount)
      ]);
      alert('Transaction deleted successfully!');
    } catch (err) {
      setError(err.message);
    }
  };

  // Create account
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

  // Check authentication and load initial data
  useEffect(() => {
    const checkAuth = async () => {
      if (token) {
        try {
          const data = await fetchAPI('/api/auth/me');
          setUser(data);
          setIsAuthenticated(true);
        } catch (err) {
          // Token invalid, clear it
          handleLogout();
        }
      }
      setLoading(false);
    };

    checkAuth();
  }, [token]);

  // Load accounts when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      loadAccounts();
    }
  }, [isAuthenticated]);

  // Load data when account is selected
  useEffect(() => {
    if (selectedAccount) {
      loadTransactions(selectedAccount);
      loadRecurringTransactions(selectedAccount);
      loadAnalytics(selectedAccount);
    }
  }, [selectedAccount]);

  // Calculate summary statistics from analytics
  const getSummaryStats = () => {
    if (!analytics || !analytics.summary) {
      return {
        totalTransactions: 0,
        totalIncome: 0,
        totalExpenses: 0,
        netAmount: 0
      };
    }
    return {
      totalTransactions: analytics.summary.transaction_count || 0,
      totalIncome: analytics.summary.total_income || 0,
      totalExpenses: analytics.summary.total_expenses || 0,  // Already absolute value from backend
      netAmount: analytics.summary.net_amount || 0
    };
  };

  // Loading screen
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

  // Login/Register screen
  if (!isAuthenticated) {
    return <AuthScreen onLogin={handleLogin} onRegister={handleRegister} error={error} />;
  }

  const stats = getSummaryStats();

  return (
    <div className="App">
      <header className="App-header">
        <div className="header-content">
          <h1>💰 Money Tracker</h1>
          <div className="header-actions">
            <span>Welcome, {user?.username}!</span>
            <button onClick={handleLogout} className="logout-btn">Logout</button>
          </div>
        </div>

        {/* Account Selector */}
        <div className="account-selector">
          <select 
            value={selectedAccount || ''} 
            onChange={(e) => setSelectedAccount(parseInt(e.target.value))}
          >
            <option value="">Select Account</option>
            {accounts.map(account => (
              <option key={account.id} value={account.id}>
                {account.account_name} - Balance: ${account.balance?.toFixed(2) || '0.00'}
              </option>
            ))}
          </select>
          <button 
            onClick={() => {
              const accountId = prompt('Enter account ID:');
              const accountName = prompt('Enter account name:');
              if (accountId && accountName) {
                handleCreateAccount(accountId, accountName);
              }
            }}
            className="add-account-btn"
          >
            + Add Account
          </button>
        </div>

        {/* Navigation */}
        <nav className="view-nav">
          <button 
            className={view === 'dashboard' ? 'active' : ''} 
            onClick={() => setView('dashboard')}
          >
            📊 Dashboard
          </button>
          <button 
            className={view === 'transactions' ? 'active' : ''} 
            onClick={() => setView('transactions')}
          >
            💳 Transactions
          </button>
          <button 
            className={view === 'analytics' ? 'active' : ''} 
            onClick={() => setView('analytics')}
          >
            📈 Analytics
          </button>
          <button 
            className={view === 'recurring' ? 'active' : ''} 
            onClick={() => setView('recurring')}
          >
            🔄 Recurring
          </button>
        </nav>

        {error && (
          <div className="error-message">
            {error}
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}

        {/* Dashboard View */}
        {view === 'dashboard' && selectedAccount && (
          <div className="dashboard-view">
            <div className="stats-grid">
              <div className="stat-card">
                <h3>Total Transactions</h3>
                <div className="value">{stats.totalTransactions}</div>
              </div>
              <div className="stat-card">
                <h3>Total Income</h3>
                <div className="value green">${stats.totalIncome.toFixed(2)}</div>
              </div>
              <div className="stat-card">
                <h3>Total Expenses</h3>
                <div className="value red">${stats.totalExpenses.toFixed(2)}</div>
              </div>
              <div className="stat-card">
                <h3>Net Amount</h3>
                <div className="value">${stats.netAmount.toFixed(2)}</div>
              </div>
            </div>

            {/* Category Breakdown */}
            {analytics?.category_breakdown && (
              <div className="category-section">
                <h3>Spending by Category</h3>
                <div className="category-list">
                  {Object.entries(analytics.category_breakdown).map(([category, amount]) => (
                    <div key={category} className="category-item">
                      <span>{category}</span>
                      <span className={amount < 0 ? 'red' : 'green'}>
                        ${Math.abs(amount).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Transactions */}
            <div className="recent-transactions-section">
              <h3>Recent Transactions</h3>
              <TransactionList 
                transactions={transactions.slice(0, 10)} 
                onDelete={handleDeleteTransaction}
              />
            </div>
          </div>
        )}

        {/* Transactions View */}
        {view === 'transactions' && selectedAccount && (
          <div className="transactions-view">
            <div className="transactions-header">
              <h2>All Transactions</h2>
              <button 
                onClick={() => setShowTransactionForm(!showTransactionForm)}
                className="add-btn"
              >
                {showTransactionForm ? 'Cancel' : '+ Add Transaction'}
              </button>
            </div>

            {showTransactionForm && (
              <form onSubmit={handleAddTransaction} className="transaction-form">
                <div className="form-group">
                  <label>Date</label>
                  <input
                    type="date"
                    value={transactionFormData.date}
                    onChange={(e) => setTransactionFormData({...transactionFormData, date: e.target.value})}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Vendor</label>
                  <input
                    type="text"
                    value={transactionFormData.vendor}
                    onChange={(e) => setTransactionFormData({...transactionFormData, vendor: e.target.value})}
                    placeholder="e.g., Grocery Store"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Category</label>
                  <input
                    type="text"
                    value={transactionFormData.category}
                    onChange={(e) => setTransactionFormData({...transactionFormData, category: e.target.value})}
                    placeholder="e.g., Food, Transport"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    value={transactionFormData.amount}
                    onChange={(e) => setTransactionFormData({...transactionFormData, amount: e.target.value})}
                    placeholder="Positive for income, negative for expenses"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Notes (optional)</label>
                  <input
                    type="text"
                    value={transactionFormData.notes}
                    onChange={(e) => setTransactionFormData({...transactionFormData, notes: e.target.value})}
                  />
                </div>
                <button type="submit" className="submit-btn">Add Transaction</button>
              </form>
            )}

            <TransactionList 
              transactions={transactions} 
              onDelete={handleDeleteTransaction}
              showAll={true}
            />
          </div>
        )}

        {/* Analytics View */}
        {view === 'analytics' && selectedAccount && analytics && (
          <div className="analytics-view">
            <h2>Financial Analytics</h2>
            
            <div className="analytics-section">
              <h3>Monthly Breakdown</h3>
              {analytics.monthly_breakdown && (
                <div className="monthly-list">
                  {Object.entries(analytics.monthly_breakdown).map(([month, data]) => (
                    <div key={month} className="monthly-item">
                      <div className="month-name">{month}</div>
                      <div className="month-stats">
                        <span className="green">Income: ${data.income?.toFixed(2) || '0.00'}</span>
                        <span className="red">Expenses: ${Math.abs(data.expenses || 0).toFixed(2)}</span>
                        <span>Net: ${data.net?.toFixed(2) || '0.00'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="analytics-section">
              <h3>Top Vendors</h3>
              {analytics.top_vendors && (
                <div className="vendor-list">
                  {analytics.top_vendors.map((vendor, idx) => (
                    <div key={idx} className="vendor-item">
                      <span>{vendor.vendor}</span>
                      <span>${Math.abs(vendor.amount).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Recurring Transactions View */}
        {view === 'recurring' && selectedAccount && (
          <div className="recurring-view">
            <h2>Recurring Transactions</h2>
            <div className="recurring-list">
              {recurringTransactions.length === 0 ? (
                <p>No recurring transactions found</p>
              ) : (
                recurringTransactions.map(recurring => (
                  <div key={recurring.id} className="recurring-item">
                    <div className="recurring-info">
                      <strong>{recurring.vendor}</strong>
                      <span>{recurring.category}</span>
                      <span>Every {recurring.frequency} days</span>
                    </div>
                    <div className="recurring-amount">
                      ${Math.abs(recurring.amount).toFixed(2)}
                    </div>
                    <div className="recurring-dates">
                      <small>Next: {recurring.next_date}</small>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {!selectedAccount && (
          <div className="no-account-message">
            <h2>No Account Selected</h2>
            <p>Please select an account or create a new one to get started.</p>
          </div>
        )}
      </header>
    </div>
  );
}

// Auth Screen Component
function AuthScreen({ onLogin, onRegister, error }) {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isLogin) {
      onLogin(formData.username, formData.password);
    } else {
      onRegister(formData.username, formData.email, formData.password);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-container">
        <h1>💰 Money Tracker</h1>
        <h2>{isLogin ? 'Login' : 'Register'}</h2>
        
        {error && <div className="error-message">{error}</div>}
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              value={formData.username}
              onChange={(e) => setFormData({...formData, username: e.target.value})}
              required
            />
          </div>
          
          {!isLogin && (
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                required
              />
            </div>
          )}
          
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({...formData, password: e.target.value})}
              required
            />
          </div>
          
          <button type="submit" className="submit-btn">
            {isLogin ? 'Login' : 'Register'}
          </button>
        </form>
        
        <p className="toggle-auth">
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <button onClick={() => setIsLogin(!isLogin)}>
            {isLogin ? 'Register' : 'Login'}
          </button>
        </p>
      </div>
    </div>
  );
}

// Transaction List Component
function TransactionList({ transactions, onDelete, showAll = false }) {
  if (!transactions || transactions.length === 0) {
    return <p className="no-data">No transactions found</p>;
  }

  return (
    <div className="transaction-list">
      {transactions.map(transaction => (
        <div key={transaction.id} className="transaction-item">
          <div className="transaction-info">
            <strong>{transaction.vendor}</strong>
            <span>{transaction.category} • {transaction.date}</span>
            {transaction.notes && <small>{transaction.notes}</small>}
          </div>
          <div className="transaction-right">
            <div className={`transaction-amount ${transaction.amount >= 0 ? 'green' : 'red'}`}>
              {transaction.amount >= 0 ? '+' : ''}${Math.abs(transaction.amount).toFixed(2)}
            </div>
            {showAll && (
              <button 
                onClick={() => onDelete(transaction.id)} 
                className="delete-btn"
                title="Delete transaction"
              >
                🗑️
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default App;