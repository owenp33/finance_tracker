import { useState } from 'react';
import AllTransactionsTab from './transactions/AllTransactionsTab';
import RecurringTab from './transactions/RecurringTab';
import FlaggedTab from './transactions/FlaggedTab';
import ImportView from './ImportView';
import AccountsView from './AccountsView';

function TransactionsView({
  transactions,
  accounts,
  recurringTransactions,
  onAdd,
  onAddRecurring,
  onEdit,
  onDelete,
  onDeleteMany,
  onToggleTransfer,
  onToggleTransferMany,
  onPairTransfer,
  onBreakTransferLink,
  onDeleteTransferBulk,
  onEditRecurring,
  onDeleteRecurring,
  onImportDone,
  onCreateAccount,
  onEditAccount,
  onDeleteAccount,
}) {
  const [tab, setTab] = useState('all');

  const flaggedCount = transactions.filter(t => t.over_budget).length;

  return (
    <div className="transactions-view">
      <div className="tab-bar">
        <button className={`tab-btn${tab === 'all'       ? ' active' : ''}`} onClick={() => setTab('all')}>All</button>
        <button className={`tab-btn${tab === 'recurring' ? ' active' : ''}`} onClick={() => setTab('recurring')}>Recurring</button>
        <button className={`tab-btn${tab === 'accounts'  ? ' active' : ''}`} onClick={() => setTab('accounts')}>Accounts</button>
        <button className={`tab-btn${tab === 'import'    ? ' active' : ''}`} onClick={() => setTab('import')}>Import</button>
        <button className={`tab-btn${tab === 'flagged'   ? ' active' : ''}`} onClick={() => setTab('flagged')}>
          Flagged {flaggedCount > 0 && <span className="count-badge flagged-badge">{flaggedCount}</span>}
        </button>
      </div>

      {tab === 'all' && (
        <AllTransactionsTab
          transactions={transactions}
          accounts={accounts}
          onAdd={onAdd}
          onAddRecurring={onAddRecurring}
          onEdit={onEdit}
          onDelete={onDelete}
          onDeleteMany={onDeleteMany}
          onToggleTransfer={onToggleTransfer}
          onToggleTransferMany={onToggleTransferMany}
          onGoToImport={() => setTab('import')}
        />
      )}

      {tab === 'recurring' && (
        <RecurringTab
          transactions={transactions}
          accounts={accounts}
          recurringTransactions={recurringTransactions}
          onAdd={onAdd}
          onAddRecurring={onAddRecurring}
          onEdit={onEdit}
          onDelete={onDelete}
          onDeleteMany={onDeleteMany}
          onToggleTransfer={onToggleTransfer}
          onToggleTransferMany={onToggleTransferMany}
          onEditRecurring={onEditRecurring}
          onDeleteRecurring={onDeleteRecurring}
        />
      )}

      {tab === 'import' && (
        <ImportView
          accounts={accounts}
          onImportDone={onImportDone}
          onNavigateAway={() => setTab('all')}
        />
      )}

      {tab === 'accounts' && (
        <AccountsView
          transactions={transactions}
          accounts={accounts}
          onEdit={onEdit}
          onDelete={onDelete}
          onPairTransfer={onPairTransfer}
          onDeleteTransferBulk={onDeleteTransferBulk}
          onCreateAccount={onCreateAccount}
          onEditAccount={onEditAccount}
          onDeleteAccount={onDeleteAccount}
        />
      )}

      {tab === 'flagged' && (
        <FlaggedTab
          transactions={transactions}
          accounts={accounts}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

export default TransactionsView;
