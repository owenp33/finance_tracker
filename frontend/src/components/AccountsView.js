import { useState } from 'react';
import { Pencil, Trash2, ChevronDown, ChevronRight } from 'lucide-react';

const formatDate = (dateStr) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
}) {
  const [showAddAccountForm, setShowAddAccountForm] = useState(false);
  const [newAccountId, setNewAccountId] = useState('');
  const [newAccountName, setNewAccountName] = useState('');
  const [accountAdding, setAccountAdding] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState(null);
  const [editingAccountName, setEditingAccountName] = useState('');
  const [editingAccountIdStr, setEditingAccountIdStr] = useState('');
  const [pairingTxId, setPairingTxId] = useState(null);
  const [pairingToAccountId, setPairingToAccountId] = useState('');
  const [selectedTransferIds, setSelectedTransferIds] = useState(new Set());
  const [transferBulkToAccountId, setTransferBulkToAccountId] = useState('');
  const [expandedAccountIds, setExpandedAccountIds] = useState(new Set());
  const [editingTransferId, setEditingTransferId] = useState(null);
  const [editTransferFields, setEditTransferFields] = useState({});
  const [movingPeerId, setMovingPeerId] = useState(null);
  const [movingToAccountId, setMovingToAccountId] = useState('');
  const [transferConfig, setTransferConfigState] = useState({});

  const getTransferConfig = (id) => transferConfig[id] || { sort: 'date-desc' };
  const setTransferConfig = (id, updates) =>
    setTransferConfigState(prev => ({ ...prev, [id]: { ...getTransferConfig(id), ...updates } }));

  const applyTransferSort = (list, sort) => {
    const s = [...list];
    if (sort === 'date-asc')    return s.sort((a, b) => a.date.localeCompare(b.date));
    if (sort === 'date-desc')   return s.sort((a, b) => b.date.localeCompare(a.date));
    if (sort === 'amount-asc')  return s.sort((a, b) => a.amount - b.amount);
    if (sort === 'amount-desc') return s.sort((a, b) => b.amount - a.amount);
    return s;
  };

  const toggleAccountExpand = (id) =>
    setExpandedAccountIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleTransferSelect = (id) =>
    setSelectedTransferIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const startTransferEdit = (t) => {
    setEditingTransferId(t.id);
    setEditTransferFields({ date: t.date, vendor: t.vendor, amount: t.amount, notes: t.notes || '' });
  };
  const setETF = (field, val) => setEditTransferFields(prev => ({ ...prev, [field]: val }));
  const saveTransferEdit = async (t) => {
    await onEdit(t.id, { ...editTransferFields, account_id: t.account_id, category: t.category });
    setEditingTransferId(null);
  };

  return (
    <div className="accounts-view">
      <div className="view-header">
        <h2>Bank Accounts</h2>
        {!showAddAccountForm && (
          <button className="btn btn-primary" onClick={() => setShowAddAccountForm(true)}>+ Add Account</button>
        )}
      </div>

      {showAddAccountForm && (
        <div className="account-form">
          <div className="form-group">
            <label>Account ID <small>(e.g. checking-1234)</small></label>
            <input type="text" value={newAccountId} onChange={e => setNewAccountId(e.target.value)} placeholder="checking-1234" autoFocus />
          </div>
          <div className="form-group">
            <label>Display Name</label>
            <input type="text" value={newAccountName} onChange={e => setNewAccountName(e.target.value)} placeholder="Chase Checking" />
          </div>
          <div className="form-actions">
            <button
              className="btn btn-primary"
              disabled={!newAccountId.trim() || accountAdding}
              onClick={async () => {
                setAccountAdding(true);
                await onCreateAccount(newAccountId.trim(), newAccountName.trim() || newAccountId.trim());
                setNewAccountId('');
                setNewAccountName('');
                setShowAddAccountForm(false);
                setAccountAdding(false);
              }}
            >
              {accountAdding ? 'Adding…' : 'Add'}
            </button>
            <button className="btn btn-ghost" onClick={() => { setShowAddAccountForm(false); setNewAccountId(''); setNewAccountName(''); }}>Cancel</button>
          </div>
        </div>
      )}

      <div className="accounts-list">
        {accounts.length === 0 ? (
          <p className="no-data">No accounts yet. Add one above.</p>
        ) : (
          accounts.map(a => {
            const cfg = getTransferConfig(a.id);
            const accountTransfers = transactions.filter(t => t.is_transfer && t.account_id === a.id);
            const visibleTransfers = applyTransferSort(accountTransfers, cfg.sort);

            return (
              <div key={a.id} className="account-item">
                {editingAccountId === a.id ? (
                  <div className="account-edit-form">
                    <div className="form-group">
                      <label>Account ID</label>
                      <input
                        type="text"
                        value={editingAccountIdStr}
                        onChange={e => setEditingAccountIdStr(e.target.value)}
                        placeholder="e.g., checking-1234"
                        autoFocus
                      />
                    </div>
                    <div className="form-group">
                      <label>Display Name</label>
                      <input
                        type="text"
                        value={editingAccountName}
                        onChange={e => setEditingAccountName(e.target.value)}
                        placeholder="e.g., Chase Checking"
                      />
                    </div>
                    <div className="account-edit-actions">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={async () => {
                          await onEditAccount(a.id, { account_id: editingAccountIdStr, account_name: editingAccountName });
                          setEditingAccountId(null);
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
                        disabled={accountTransfers.length === 0}
                        title={accountTransfers.length === 0 ? 'No transfers' : (expandedAccountIds.has(a.id) ? 'Collapse' : 'Expand transfers')}
                      >
                        {expandedAccountIds.has(a.id) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </button>
                      <div className="account-info">
                        <strong>{a.account_name}</strong>
                        <small>
                          {a.account_id}
                          {accountTransfers.length > 0 && (
                            <span className="account-transfer-count">
                              {accountTransfers.length} transfer{accountTransfers.length !== 1 ? 's' : ''}
                            </span>
                          )}
                        </small>
                      </div>
                      <div className={`account-balance ${a.balance >= 0 ? 'green' : 'red'}`}>
                        ${a.balance?.toFixed(2) ?? '0.00'}
                      </div>
                      <div className="account-actions">
                        <button
                          className="btn btn-ghost btn-sm icon-btn"
                          title="Edit"
                          onClick={() => {
                            setEditingAccountId(a.id);
                            setEditingAccountName(a.account_name);
                            setEditingAccountIdStr(a.account_id);
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

                    {accountTransfers.length > 0 && expandedAccountIds.has(a.id) && (() => {
                      const acctSelected = accountTransfers.filter(t => selectedTransferIds.has(t.id));
                      const allSelected  = accountTransfers.every(t => selectedTransferIds.has(t.id));
                      const someSelected = acctSelected.length > 0;

                      const toggleAll = () => {
                        if (allSelected) {
                          setSelectedTransferIds(prev => { const n = new Set(prev); accountTransfers.forEach(t => n.delete(t.id)); return n; });
                        } else {
                          setSelectedTransferIds(prev => { const n = new Set(prev); accountTransfers.forEach(t => n.add(t.id)); return n; });
                        }
                      };

                      const handleBulkMove = async () => {
                        const toId = parseInt(transferBulkToAccountId);
                        for (const t of acctSelected) await onPairTransfer(t.id, toId);
                        setTransferBulkToAccountId('');
                      };

                      const handleBulkDelete = async () => {
                        await onDeleteTransferBulk(acctSelected.map(t => t.id));
                        setSelectedTransferIds(prev => { const n = new Set(prev); acctSelected.forEach(t => n.delete(t.id)); return n; });
                      };

                      const peerGroups = {};
                      for (const t of accountTransfers) {
                        if (!t.transfer_peer_account) continue;
                        const peer = t.transfer_peer_account;
                        if (!peerGroups[peer]) peerGroups[peer] = { out: 0, in: 0 };
                        if (t.amount < 0) peerGroups[peer].out += Math.abs(t.amount);
                        else peerGroups[peer].in += t.amount;
                      }
                      const unlinkedCount = accountTransfers.filter(t => !t.transfer_peer_account).length;

                      return (
                        <div className="account-transfers">
                          <div className="account-transfers-header">
                            <label className="bulk-select-all">
                              <input
                                type="checkbox"
                                checked={allSelected}
                                ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                                onChange={toggleAll}
                              />
                              <span>
                                {someSelected
                                  ? `${acctSelected.length} of ${accountTransfers.length} selected`
                                  : `Transfers (${accountTransfers.length})`}
                              </span>
                            </label>
                            <div
                              className="transfer-bulk-bar"
                              style={!someSelected ? { visibility: 'hidden', pointerEvents: 'none' } : {}}
                            >
                              <span className="transfer-bulk-hint">Move {acctSelected.length} to:</span>
                              <select value={transferBulkToAccountId} onChange={e => setTransferBulkToAccountId(e.target.value)}>
                                <option value="">— account —</option>
                                {accounts.filter(ac => ac.id !== a.id).map(ac => (
                                  <option key={ac.id} value={ac.id}>{ac.account_name}</option>
                                ))}
                              </select>
                              <button className="btn btn-primary btn-sm" disabled={!transferBulkToAccountId} onClick={handleBulkMove}>Move</button>
                              <button className="btn btn-danger btn-sm" onClick={handleBulkDelete}>Delete {acctSelected.length}</button>
                            </div>
                            <div className="transfer-sort-controls">
                              <select
                                className="transfer-sort-select"
                                value={cfg.sort}
                                onChange={e => setTransferConfig(a.id, { sort: e.target.value })}
                              >
                                <option value="date-desc">Date (Most Recent)</option>
                                <option value="date-asc">Date (Oldest)</option>
                                <option value="amount-desc">Amount (Greatest)</option>
                                <option value="amount-asc">Amount (Least)</option>
                              </select>
                              {cfg.sort !== 'date-desc' && (
                                <button
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => setTransferConfig(a.id, { sort: 'date-desc' })}
                                >Reset</button>
                              )}
                            </div>
                          </div>

                          {(Object.keys(peerGroups).length > 0 || unlinkedCount > 0) && (
                            <div className="transfer-relationship-summary">
                              {Object.entries(peerGroups).map(([peer, { out, in: inn }]) => (
                                <div key={peer} className="transfer-rel-row">
                                  <span className="transfer-rel-peer">{peer}</span>
                                  <span className="transfer-rel-flows">
                                    {out > 0 && <span className="transfer-rel-out">${out.toFixed(2)} out</span>}
                                    {inn > 0 && <span className="transfer-rel-in">${inn.toFixed(2)} in</span>}
                                  </span>
                                </div>
                              ))}
                              {unlinkedCount > 0 && (
                                <div className="transfer-rel-row">
                                  <span className="transfer-rel-unlinked">{unlinkedCount} unlinked</span>
                                </div>
                              )}
                            </div>
                          )}

                          {(() => {
                            const vendorOrder = [];
                            const byVendor = {};
                            for (const t of visibleTransfers) {
                              if (!byVendor[t.vendor]) { vendorOrder.push(t.vendor); byVendor[t.vendor] = []; }
                              byVendor[t.vendor].push(t);
                            }
                            return vendorOrder.map(vendor => {
                              const group = byVendor[vendor];
                              const net = group.reduce((s, t) => s + t.amount, 0);
                              return (
                                <div key={vendor}>
                                  <div className="transfer-vendor-header">
                                    <span className="transfer-vendor-name">{vendor}</span>
                                    <span className={`transfer-vendor-net ${net >= 0 ? 'green' : 'red'}`}>
                                      {net >= 0 ? '+' : '-'}${Math.abs(net).toFixed(2)}
                                    </span>
                                  </div>
                                  {group.map(t => (
                                    <div key={t.id} className={`account-transfer-row${selectedTransferIds.has(t.id) ? ' transfer-selected' : ''}`}>
                                      {editingTransferId === t.id ? (
                                        <div className="transfer-edit-row">
                                          <input type="date" value={editTransferFields.date} onChange={e => setETF('date', e.target.value)} />
                                          <input type="text" value={editTransferFields.vendor} onChange={e => setETF('vendor', e.target.value)} placeholder="Vendor" />
                                          <input type="number" step="0.01" value={editTransferFields.amount} onChange={e => setETF('amount', e.target.value)} placeholder="Amount" />
                                          <input type="text" value={editTransferFields.notes} onChange={e => setETF('notes', e.target.value)} placeholder="Notes" />
                                          <button className="btn btn-primary btn-sm" onClick={() => saveTransferEdit(t)}>Save</button>
                                          <button className="btn btn-ghost btn-sm" onClick={() => setEditingTransferId(null)}>Cancel</button>
                                        </div>
                                      ) : (
                                        <>
                                          <input
                                            type="checkbox"
                                            className="transfer-checkbox"
                                            checked={selectedTransferIds.has(t.id)}
                                            onChange={() => toggleTransferSelect(t.id)}
                                          />
                                          <span className="account-transfer-date">{formatDate(t.date)}</span>
                                          <span className="account-transfer-direction">
                                            {t.amount < 0 ? 'To' : 'From'}
                                          </span>
                                          <span className="account-transfer-peer">
                                            {t.transfer_peer_id ? (
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
                                          <div className="account-transfer-right">
                                            <span className={`account-transfer-amount ${t.amount >= 0 ? 'green' : 'red'}`}>
                                              {t.amount >= 0 ? '+' : '-'}${Math.abs(t.amount).toFixed(2)}
                                            </span>
                                            <div className="transfer-row-actions">
                                              <button
                                                className="btn btn-ghost btn-sm icon-btn transfer-action-btn"
                                                title="Edit"
                                                onClick={() => startTransferEdit(t)}
                                              ><Pencil size={13} /></button>
                                              <button
                                                className="btn btn-danger btn-sm icon-btn transfer-action-btn"
                                                title="Delete"
                                                onClick={() => onDelete(t.id)}
                                              ><Trash2 size={13} /></button>
                                            </div>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              );
                            });
                          })()}
                        </div>
                      );
                    })()}
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
