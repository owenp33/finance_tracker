import { useState } from 'react';
import { Pencil, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { formatDollars, formatSignedCents } from '../utils/money';
import AccountKindFields from './AccountKindFields';
import InterestFields from './InterestFields';
import AccountGoalProgress from './goals/AccountGoalProgress';
import { useGoals } from '../hooks/useGoals';
import GroupedTransactionList from './transactions/GroupedTransactionList';
import { isLoanEntry, LOAN_ENTRY_TITLE } from './transactions/utils';

// A typed dollar amount in cents, or null while it's blank or not a number
const typedCents = (text) => {
  const dollars = Number(text);
  return text.trim() === '' || !Number.isFinite(dollars) ? null : Math.round(dollars * 100);
};

// A typed yearly rate (percent), or null while it's blank: no interest
const typedApr = (text) => (text.trim() === '' ? null : Number(text));

// A stable stand-in when no one listens for errors (useGoals refetches when it changes)
const IGNORE_ERROR = () => {};

// The rate and how often it hits, as account fields for the API (both null without a rate)
const interestFields = (aprText, frequency) => {
  const apr = typedApr(aprText);
  return { apr, interest_frequency: apr === null ? null : frequency };
};

function AccountsView({
  transactions,
  accounts,
  onEdit,
  onDelete,
  onPairTransfer,
  onDeleteTransferBulk,
  onCreateAccount,
  onEditAccount,
  onDeleteAccount,
  onError = IGNORE_ERROR,
}) {
  // Each account's goals show their progress on its row (Phase F, F2f)
  const { goals } = useGoals(onError, accounts);
  const [showAddAccountForm, setShowAddAccountForm] = useState(false);
  const [newAccountId, setNewAccountId] = useState('');
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountKind, setNewAccountKind] = useState('bank');
  const [newAccountApr, setNewAccountApr] = useState('');
  const [newAccountFrequency, setNewAccountFrequency] = useState('monthly');
  const [accountAdding, setAccountAdding] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState(null);
  const [editingAccountName, setEditingAccountName] = useState('');
  const [editingAccountIdStr, setEditingAccountIdStr] = useState('');
  const [editingKind, setEditingKind] = useState('bank');
  const [editingApr, setEditingApr] = useState('');
  const [editingFrequency, setEditingFrequency] = useState('monthly');
  const [editingOpeningBalance, setEditingOpeningBalance] = useState('');
  const [editingCurrentBalance, setEditingCurrentBalance] = useState('');
  const [editingBalanceSource, setEditingBalanceSource] = useState('opening');   // the one typed in last
  const [pairingTxId, setPairingTxId] = useState(null);
  const [pairingToAccountId, setPairingToAccountId] = useState('');
  const [transferBulkToAccountId, setTransferBulkToAccountId] = useState('');
  const [expandedAccountIds, setExpandedAccountIds] = useState(new Set());
  const [movingPeerId, setMovingPeerId] = useState(null);
  const [movingToAccountId, setMovingToAccountId] = useState('');

  // The name of the account a loan entry's payment came from
  const payingAccount = (entry) => {
    const payment = transactions.find(t => t.id === entry.loan_payment_id);
    return accounts.find(ac => ac.id === payment?.account_id)?.account_name ?? '';
  };

  const toggleAccountExpand = (id) =>
    setExpandedAccountIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });


  // A row's "To" / "From" and its other account: a transfer's peer (click to move it, or to link an
  // unlinked one), a loan entry's paying account; a loan's other transactions (interest) have none
  const transferPeer = (t, a, isLoan) => (
    <>
      <span className="account-transfer-direction">
        {isLoan && !isLoanEntry(t) ? '' : t.amount < 0 ? 'To' : 'From'}
      </span>
      <span className="account-transfer-peer">
        {isLoan ? (
          isLoanEntry(t) && <span className="account-loan-payer">{payingAccount(t)}</span>
        ) : t.transfer_peer_id ? (
          movingPeerId === t.id ? (
            <span className="account-transfer-pair-picker">
              <select value={movingToAccountId} onChange={e => setMovingToAccountId(e.target.value)} autoFocus>
                <option value="">— select account —</option>
                {accounts.filter(ac => ac.id !== a.id).map(ac => (
                  <option key={ac.id} value={ac.id}>{ac.account_name}</option>
                ))}
              </select>
              <button
                className="btn btn-primary btn-sm"
                disabled={!movingToAccountId}
                onClick={async () => {
                  await onPairTransfer(t.id, parseInt(movingToAccountId));
                  setMovingPeerId(null);
                  setMovingToAccountId('');
                }}
              >Move</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setMovingPeerId(null); setMovingToAccountId(''); }}>✕</button>
            </span>
          ) : (
            <span
              className="account-transfer-peer-name"
              title="Click to change linked account"
              onClick={() => { setMovingPeerId(t.id); setMovingToAccountId(''); }}
            >{t.transfer_peer_account}</span>
          )
        ) : (
          pairingTxId === t.id ? (
            <span className="account-transfer-pair-picker">
              <select value={pairingToAccountId} onChange={e => setPairingToAccountId(e.target.value)} autoFocus>
                <option value="">— select account —</option>
                {accounts.filter(ac => ac.id !== a.id).map(ac => (
                  <option key={ac.id} value={ac.id}>{ac.account_name}</option>
                ))}
              </select>
              <button
                className="btn btn-primary btn-sm"
                disabled={!pairingToAccountId}
                onClick={async () => {
                  await onPairTransfer(t.id, parseInt(pairingToAccountId));
                  setPairingTxId(null);
                  setPairingToAccountId('');
                }}
              >Link</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setPairingTxId(null); setPairingToAccountId(''); }}>✕</button>
            </span>
          ) : (
            <span
              className="account-transfer-unlinked"
              title="Click to link to another account"
              onClick={() => { setPairingTxId(t.id); setPairingToAccountId(''); }}
            >Unlinked</span>
          )
        )}
      </span>
    </>
  );

  const closeAddForm = () => {
    setShowAddAccountForm(false);
    setNewAccountId('');
    setNewAccountName('');
    setNewAccountKind('bank');
    setNewAccountApr('');
    setNewAccountFrequency('monthly');
  };

  return (
    <div className="accounts-view">
      <div className="view-header">
        <h2>Accounts</h2>
        {!showAddAccountForm && (
          <button className="btn btn-primary" onClick={() => setShowAddAccountForm(true)}>+ Add Account</button>
        )}
      </div>

      {showAddAccountForm && (
        <div className="account-form">
          <div className="form-group">
            <label htmlFor="new-account-id">Account ID <small>(e.g. checking-1234)</small></label>
            <input id="new-account-id" type="text" value={newAccountId} onChange={e => setNewAccountId(e.target.value)} placeholder="checking-1234" autoFocus />
          </div>
          <div className="form-group">
            <label htmlFor="new-account-name">Display Name</label>
            <input id="new-account-name" type="text" value={newAccountName} onChange={e => setNewAccountName(e.target.value)} placeholder="Chase Checking" />
          </div>
          <AccountKindFields idPrefix="new-account" kind={newAccountKind} onKind={setNewAccountKind} />
          <InterestFields
            idPrefix="new-account" kind={newAccountKind} apr={newAccountApr} onApr={setNewAccountApr}
            frequency={newAccountFrequency} onFrequency={setNewAccountFrequency}
          />
          <div className="form-actions">
            <button
              className="btn btn-primary"
              disabled={!newAccountId.trim() || accountAdding}
              onClick={async () => {
                setAccountAdding(true);
                await onCreateAccount({
                  account_id: newAccountId.trim(),
                  account_name: newAccountName.trim() || newAccountId.trim(),
                  kind: newAccountKind,
                  ...interestFields(newAccountApr, newAccountFrequency),
                });
                closeAddForm();
                setAccountAdding(false);
              }}
            >
              {accountAdding ? 'Adding…' : 'Add'}
            </button>
            <button className="btn btn-ghost" onClick={closeAddForm}>Cancel</button>
          </div>
        </div>
      )}

      <div className="accounts-list">
        {accounts.length === 0 ? (
          <p className="no-data">No accounts yet. Add one above.</p>
        ) : (
          accounts.map(a => {
            // A loan's row lists everything on it (its payments' loan entries are bills paid from
            // another account, not transfers, and it's charged interest); any other account's row
            // lists its transfers. Both show in the same list.
            const isLoan = a.kind === 'loan';
            const listed = transactions.filter(t => t.account_id === a.id && (isLoan || t.is_transfer));
            const expandable = listed.length > 0;
            const expanded = expandable && expandedAccountIds.has(a.id);
            // Starting balance + transactions (transfers included) = current balance
            const transactionCents = Math.round(a.balance * 100) - Math.round((a.opening_balance ?? 0) * 100);
            const typeStarting = (text) => {
              setEditingOpeningBalance(text);
              setEditingBalanceSource('opening');
              const cents = typedCents(text);
              if (cents !== null) setEditingCurrentBalance(((cents + transactionCents) / 100).toFixed(2));
            };
            const typeCurrent = (text) => {
              setEditingCurrentBalance(text);
              setEditingBalanceSource('current');
              const cents = typedCents(text);
              if (cents !== null) setEditingOpeningBalance(((cents - transactionCents) / 100).toFixed(2));
            };
            const typedBalance = editingBalanceSource === 'current' ? editingCurrentBalance : editingOpeningBalance;

            return (
              <div key={a.id} className="account-item">
                {editingAccountId === a.id ? (
                  <div className="account-edit-form">
                    <div className="form-group">
                      <label htmlFor={`account-${a.id}-id`}>Account ID</label>
                      <input
                        id={`account-${a.id}-id`}
                        type="text"
                        value={editingAccountIdStr}
                        onChange={e => setEditingAccountIdStr(e.target.value)}
                        placeholder="e.g., checking-1234"
                        autoFocus
                      />
                    </div>
                    <div className="form-group">
                      <label htmlFor={`account-${a.id}-name`}>Display Name</label>
                      <input
                        id={`account-${a.id}-name`}
                        type="text"
                        value={editingAccountName}
                        onChange={e => setEditingAccountName(e.target.value)}
                        placeholder="e.g., Chase Checking"
                      />
                    </div>
                    <AccountKindFields idPrefix={`account-${a.id}`} kind={editingKind} onKind={setEditingKind} />
                    <InterestFields
                      idPrefix={`account-${a.id}`} kind={editingKind} apr={editingApr} onApr={setEditingApr}
                      frequency={editingFrequency} onFrequency={setEditingFrequency}
                    />
                    <div className="form-group">
                      <label htmlFor={`account-${a.id}-opening`}>Starting balance</label>
                      <input
                        id={`account-${a.id}-opening`}
                        type="number"
                        step="0.01"
                        value={editingOpeningBalance}
                        onChange={e => typeStarting(e.target.value)}
                        placeholder="0.00"
                      />
                      <small className="account-field-hint">
                        Before its first transaction here. Negative if owed.
                      </small>
                    </div>
                    <p className="account-balance-sum">
                      Starting balance + transactions ({formatSignedCents(transactionCents)}) = current balance.
                    </p>
                    <div className="form-group">
                      <label htmlFor={`account-${a.id}-current`}>Current balance</label>
                      <input
                        id={`account-${a.id}-current`}
                        type="number"
                        step="0.01"
                        value={editingCurrentBalance}
                        onChange={e => typeCurrent(e.target.value)}
                        placeholder="0.00"
                      />
                      <small className="account-field-hint">
                        What your bank shows today, once every transaction to date is here.
                      </small>
                    </div>
                    <div className="account-edit-actions">
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={typedBalance.trim() === ''}
                        onClick={async () => {
                          const saved = await onEditAccount(a.id, {
                            account_id: editingAccountIdStr,
                            account_name: editingAccountName,
                            kind: editingKind,
                            ...interestFields(editingApr, editingFrequency),
                            ...(editingBalanceSource === 'current'
                              ? { balance: Number(editingCurrentBalance) }
                              : { opening_balance: Number(editingOpeningBalance) }),
                          });
                          if (saved) setEditingAccountId(null);
                        }}
                      >Save</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditingAccountId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="account-item-row">
                      <button
                        className="account-expand-btn"
                        onClick={() => toggleAccountExpand(a.id)}
                        disabled={!expandable}
                        title={!expandable ? (isLoan ? 'No transactions' : 'No transfers')
                          : expanded ? 'Collapse' : (isLoan ? 'Show its transactions' : 'Expand transfers')}
                      >
                        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </button>
                      <div className="account-info">
                        <strong>
                          {a.account_name}
                          {a.kind === 'loan' && <span className="loan-badge">Loan</span>}
                          {a.needs_attention && <span className="needs-attention-badge">Needs attention</span>}
                        </strong>
                        <small>
                          {a.account_id}
                          {listed.length > 0 && (
                            <span className="account-transfer-count">
                              {listed.length} {isLoan ? 'transaction' : 'transfer'}{listed.length !== 1 ? 's' : ''}
                            </span>
                          )}
                          {a.opening_balance !== 0 && (
                            <span className="account-opening-balance">
                              Starting balance {formatDollars(a.opening_balance)}
                            </span>
                          )}
                          {a.apr != null && (
                            <span className="account-apr">{`${a.apr.toFixed(2)}% a year, ${a.interest_frequency ?? 'monthly'}`}</span>
                          )}
                        </small>
                        <AccountGoalProgress goals={(goals ?? []).filter(goal => goal.account_id === a.id)} />
                        {a.needs_attention && (
                          <small className="needs-attention-hint">
                            Made by an import: check it, then edit or click “Looks good”.
                          </small>
                        )}
                      </div>
                      <div className={`account-balance ${a.balance >= 0 ? 'green' : 'red'}`}>
                        {formatDollars(a.balance)}
                      </div>
                      <div className="account-actions">
                        {a.needs_attention && (
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => onEditAccount(a.id, { needs_attention: false })}
                          >Looks good</button>
                        )}
                        <button
                          className="btn btn-ghost btn-sm icon-btn"
                          title="Edit"
                          onClick={() => {
                            setEditingAccountId(a.id);
                            setEditingAccountName(a.account_name);
                            setEditingAccountIdStr(a.account_id);
                            setEditingKind(a.kind ?? 'bank');
                            setEditingApr(a.apr == null ? '' : String(a.apr));
                            setEditingFrequency(a.interest_frequency ?? 'monthly');
                            setEditingOpeningBalance(String(a.opening_balance ?? 0));
                            setEditingCurrentBalance(String(a.balance ?? 0));
                            setEditingBalanceSource('opening');
                          }}
                        ><Pencil size={14} /></button>
                        <button
                          className="btn btn-danger btn-sm icon-btn"
                          title="Delete"
                          onClick={async () => {
                            if (!window.confirm(`Delete "${a.account_name}"? This will permanently remove all its transactions and recurring items.`)) return;
                            await onDeleteAccount(a.id);
                          }}
                        ><Trash2 size={14} /></button>
                      </div>
                    </div>


                    {expanded && (
                      <GroupedTransactionList
                        transactions={listed}
                        label={isLoan ? 'Transactions' : 'Transfers'}
                        // A loan entry follows its payment, so it can't be selected, edited or deleted
                        isLocked={isLoanEntry}
                        lockedBadge={<span className="tx-loan-chip" title={LOAN_ENTRY_TITLE}>Loan entry</span>}
                        renderMiddle={t => transferPeer(t, a, isLoan)}
                        renderBulkActions={(selected, clearSelection) => (
                          <>
                            {/* Moving re-links transfers to another account; a loan's transactions aren't transfers */}
                            {!isLoan && (
                              <>
                                <span className="transfer-bulk-hint">Move {selected.length} to:</span>
                                <select value={transferBulkToAccountId} onChange={e => setTransferBulkToAccountId(e.target.value)}>
                                  <option value="">— account —</option>
                                  {accounts.filter(ac => ac.id !== a.id).map(ac => (
                                    <option key={ac.id} value={ac.id}>{ac.account_name}</option>
                                  ))}
                                </select>
                                <button
                                  className="btn btn-primary btn-sm"
                                  disabled={!transferBulkToAccountId}
                                  onClick={async () => {
                                    const toId = parseInt(transferBulkToAccountId);
                                    for (const t of selected) await onPairTransfer(t.id, toId);
                                    setTransferBulkToAccountId('');
                                  }}
                                >Move</button>
                              </>
                            )}
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={async () => {
                                await onDeleteTransferBulk(selected.map(t => t.id));
                                clearSelection();
                              }}
                            >Delete {selected.length}</button>
                          </>
                        )}
                        onEdit={onEdit}
                        onDelete={onDelete}
                      />
                    )}
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default AccountsView;
