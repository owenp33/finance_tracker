import React, { useState } from 'react';
import OverviewTab from './insights/OverviewTab';
import RecurringCostsTab from './insights/RecurringCostsTab';
import AccountsTab from './insights/AccountsTab';
import ReportsTab from './insights/ReportsTab';

// `recurring` is every account's recurring templates, `interest` every interest hit (GET
// /api/interest); `onError` reports a failed request
const InsightsView = ({ transactions = [], accounts = [], recurring = [], interest = [], onError }) => {
  const [tab, setTab] = useState('overview');

  return (
    <div className="insights-view">
      <div className="tab-bar">
        <button className={`tab-btn${tab === 'overview' ? ' active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
        <button className={`tab-btn${tab === 'recurring' ? ' active' : ''}`} onClick={() => setTab('recurring')}>Recurring</button>
        <button className={`tab-btn${tab === 'accounts' ? ' active' : ''}`} onClick={() => setTab('accounts')}>Accounts</button>
        <button className={`tab-btn${tab === 'reports'  ? ' active' : ''}`} onClick={() => setTab('reports')}>Reports</button>
      </div>

      {tab === 'overview' && <OverviewTab transactions={transactions} accounts={accounts} />}
      {tab === 'recurring' && <RecurringCostsTab recurring={recurring} transactions={transactions} accounts={accounts} onError={onError} />}
      {tab === 'accounts' && (
        <AccountsTab accounts={accounts} transactions={transactions} recurring={recurring} interest={interest} onError={onError} />
      )}
      {tab === 'reports'  && <ReportsTab accounts={accounts} />}
    </div>
  );
};

export default InsightsView;
