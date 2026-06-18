import { useState } from 'react';
import TransactionList from '../TransactionList';
import { sortList } from './utils';

function FlaggedTab({ transactions, accounts, onEdit, onDelete }) {
  const [flaggedSort, setFlaggedSort] = useState('date-desc');

  const flagged = sortList(transactions.filter(t => t.over_budget), flaggedSort);

  return (
    <div>
      <div className="view-header">
        <h2>Over-Budget Transactions <span className="count-badge flagged-badge">{flagged.length}</span></h2>
        <div className="view-header-actions">
          <select className="sort-select" value={flaggedSort} onChange={e => setFlaggedSort(e.target.value)}>
            <option value="date-desc">Date (newest)</option>
            <option value="date-asc">Date (oldest)</option>
            <option value="amount-desc">Amount (high → low)</option>
            <option value="amount-asc">Amount (low → high)</option>
            <option value="vendor-asc">Vendor (A → Z)</option>
            <option value="vendor-desc">Vendor (Z → A)</option>
          </select>
        </div>
      </div>
      {flagged.length === 0 ? (
        <p className="no-data">No over-budget transactions — you're on track!</p>
      ) : (
        <TransactionList transactions={flagged} accounts={accounts} onEdit={onEdit} onDelete={onDelete} showAll={true} />
      )}
    </div>
  );
}

export default FlaggedTab;
