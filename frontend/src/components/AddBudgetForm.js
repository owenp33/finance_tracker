import { useState } from 'react';

function AddBudgetForm({ onAdd, onCancel, suggestedCategories = [] }) {
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    if (!category.trim() || !amount) return;
    setSaving(true);
    setError(null);
    try {
      await onAdd({ category: category.trim(), amount: parseFloat(amount) });
      setCategory('');
      setAmount('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="add-budget-form">
      <div className="form-group">
        <label>Category</label>
        <input
          list="budget-category-suggestions"
          type="text"
          value={category}
          onChange={e => setCategory(e.target.value)}
          placeholder="e.g. Groceries"
          autoFocus
        />
        <datalist id="budget-category-suggestions">
          {suggestedCategories.map(c => <option key={c} value={c} />)}
        </datalist>
      </div>
      <div className="form-group">
        <label>Monthly Allocation ($)</label>
        <input
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="0.00"
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
        />
      </div>
      {error && <p className="budget-save-error">{error}</p>}
      <div className="form-actions">
        <button
          className="btn btn-primary"
          onClick={handleSubmit}
          disabled={saving || !category.trim() || !amount}
        >
          {saving ? 'Adding…' : 'Add'}
        </button>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default AddBudgetForm;
