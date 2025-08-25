import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [apiStatus, setApiStatus] = useState('Checking...');
  const [data, setData] = useState(null);

  // Test API connection on component mount
  useEffect(() => {
    const testAPI = async () => {
      try {
        const response = await fetch(process.env.REACT_APP_API_URL || 'http://localhost:5000');
        const result = await response.json();
        setApiStatus('Connected ✅');
        setData(result);
      } catch (error) {
        setApiStatus('Failed to connect ❌');
        console.error('API connection error:', error);
      }
    };

    testAPI();
  }, []);

  return (
    <div className="App">
      <header className="App-header">
        <h1>💰 Money Tracker</h1>
        <div className="status-card">
          <h3>API Status: {apiStatus}</h3>
          {data && (
            <p>Message: {data.message}</p>
          )}
        </div>
        
        <div className="feature-grid">
          <div className="feature-card">
            <h3>📊 Dashboard</h3>
            <p>View your financial overview</p>
            <button>Coming Soon</button>
          </div>
          
          <div className="feature-card">
            <h3>💳 Transactions</h3>
            <p>Track your income and expenses</p>
            <button>Coming Soon</button>
          </div>
          
          <div className="feature-card">
            <h3>📈 Analytics</h3>
            <p>Analyze your spending patterns</p>
            <button>Coming Soon</button>
          </div>
          
          <div className="feature-card">
            <h3>🎯 Budget</h3>
            <p>Set and track your budgets</p>
            <button>Coming Soon</button>
          </div>
        </div>
      </header>
    </div>
  );
}

export default App;
