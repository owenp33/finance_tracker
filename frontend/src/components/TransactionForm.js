import React, { useState } from 'react';

function TransactionForm({ onSubmit, onCancel, accounts }) {
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    vendor: '',
    category: '',
    amount: '',
    notes: '',
    account_id: accounts?.[0]?.id || ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
    setFormData({
      date: new Date().toISOString().split('T')[0],
      vendor: '',
      category: '',
      amount: '',
      notes: '',
      account_id: accounts?.[0]?.id || ''
    });
  };

  return (
    <form onSubmit={handleSubmit} className="transaction-form">
      <div className="form-group">
        <label>Account</label>
        <select
          value={formData.account_id}
          onChange={(e) => setFormData({ ...formData, account_id: parseInt(e.target.value) })}
          required
        >
          <option value="">— select account —</option>
          {accounts?.map(a => (
            <option key={a.id} value={a.id}>{a.account_name}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Date</label>
        <input
          type="date"
          value={formData.date}
          onChange={(e) => setFormData({ ...formData, date: e.target.value })}
          required
        />
      </div>
      <div className="form-group">
        <label>Vendor</label>
        <input
          type="text"
          value={formData.vendor}
          onChange={(e) => setFormData({ ...formData, vendor: e.target.value })}
          placeholder="e.g., Grocery Store"
          required
        />
      </div>
      <div className="form-group">
        <label>Category</label>
        <input
          type="text"
          value={formData.category}
          onChange={(e) => setFormData({ ...formData, category: e.target.value })}
          placeholder="e.g., Food, Transport"
          required
        />
      </div>
      <div className="form-group">
        <label>Amount</label>
        <input
          type="number"
          step="0.01"
          value={formData.amount}
          onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
          placeholder="Positive for income, negative for expenses"
          required
        />
      </div>
      <div className="form-group">
        <label>Notes (optional)</label>
        <input
          type="text"
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
        />
      </div>
      <div className="form-actions">
        <button type="submit" className="submit-btn">Add Transaction</button>
        <button type="button" className="secondary-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default TransactionForm;
