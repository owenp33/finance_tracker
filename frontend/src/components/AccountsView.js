import { useState } from 'react';

function AccountsView({ accounts, onCreateAccount, onEditAccount, onDeleteAccount }) {
  const [editingId, setEditingId] = useState(null);
  const [editFields, setEditFields] = useState({});
  const [creating, setCreating] = useState(false);
  const [newFields, setNewFields] = useState({ account_id: '', account_name: '' });

  const startEdit = (account) => {
    setEditingId(account.id);
    setEditFields({ account_id: account.account_id, account_name: account.account_name });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditFields({});
  };

  const saveEdit = async (id) => {
    await onEditAccount(id, editFields);
    setEditingId(null);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newFields.account_id) return;
    await onCreateAccount(newFields.account_id, newFields.account_name || newFields.account_id);
    setNewFields({ account_id: '', account_name: '' });
    setCreating(false);
  };

  const handleDelete = (account) => {
    if (!window.confirm(`Delete "${account.account_name}" and all ${account.transaction_count} transactions? This cannot be undone.`)) return;
    onDeleteAccount(account.id);
  };

  return (
    <div className="accounts-view">
      <div className="view-header">
        <h2>Accounts</h2>
        <button className="btn btn-primary" onClick={() => setCreating(c => !c)}>
          {creating ? 'Cancel' : '+ New Account'}
        </button>
      </div>

      {creating && (
        <form onSubmit={handleCreate} className="transaction-form">
          <div className="form-group">
            <label>Account ID <small>(e.g. Discover 1234)</small></label>
            <input
              type="text"
              value={newFields.account_id}
              onChange={e => setNewFields({ ...newFields, account_id: e.target.value })}
              placeholder="Discover 1234"
              required
            />
          </div>
          <div className="form-group">
            <label>Display Name</label>
            <input
              type="text"
              value={newFields.account_name}
              onChange={e => setNewFields({ ...newFields, account_name: e.target.value })}
              placeholder="My Credit Card"
            />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">Create</button>
          </div>
        </form>
      )}

      <div className="account-list">
        {accounts.map(account => (
          <div key={account.id} className="account-item">
            {editingId === account.id ? (
              <div className="account-edit-form">
                <div className="account-edit-inputs">
                  <input
                    value={editFields.account_name}
                    onChange={e => setEditFields({ ...editFields, account_name: e.target.value })}
                    placeholder="Display name"
                  />
                  <input
                    value={editFields.account_id}
                    onChange={e => setEditFields({ ...editFields, account_id: e.target.value })}
                    placeholder="Account ID"
                  />
                </div>
                <div className="account-edit-actions">
                  <button className="btn btn-primary btn-sm" onClick={() => saveEdit(account.id)}>Save</button>
                  <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="account-info">
                <div className="account-details">
                  <strong>{account.account_name}</strong>
                  <span className="account-id-label">{account.account_id}</span>
                  <span className="account-meta">{account.transaction_count} transactions</span>
                </div>
                <div className="account-right">
                  <span className={`account-balance ${account.balance >= 0 ? 'green' : 'red'}`}>
                    ${account.balance?.toFixed(2) || '0.00'}
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={() => startEdit(account)}>Edit</button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(account)}>Delete</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default AccountsView;
