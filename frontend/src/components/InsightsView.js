import React, { useState } from 'react';
import OverviewTab from './insights/OverviewTab';
import ReportsTab from './insights/ReportsTab';

const InsightsView = ({ transactions = [], accounts = [] }) => {
  const [tab, setTab] = useState('overview');

  return (
    <div className="insights-view">
      <div className="tab-bar">
        <button className={`tab-btn${tab === 'overview' ? ' active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
        <button className={`tab-btn${tab === 'reports'  ? ' active' : ''}`} onClick={() => setTab('reports')}>Reports</button>
      </div>

      {tab === 'overview' && <OverviewTab transactions={transactions} accounts={accounts} />}
      {tab === 'reports'  && <ReportsTab transactions={transactions} accounts={accounts} />}
    </div>
  );
};

export default InsightsView;
