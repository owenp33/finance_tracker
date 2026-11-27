import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { formatDate } from './utils';

const SORTS = [
  ['date-desc', 'Date (Most Recent)'],
  ['date-asc', 'Date (Oldest)'],
  ['amount-desc', 'Amount (Greatest)'],
  ['amount-asc', 'Amount (Least)'],
];

// The rows in the chosen order (ties keep their order)
const sortRows = (rows, sort) => {
  const sorted = [...rows];
  if (sort === 'date-asc') return sorted.sort((a, b) => a.date.localeCompare(b.date));
  if (sort === 'date-desc') return sorted.sort((a, b) => b.date.localeCompare(a.date));
  if (sort === 'amount-asc') return sorted.sort((a, b) => a.amount - b.amount);
  if (sort === 'amount-desc') return sorted.sort((a, b) => b.amount - a.amount);
  return sorted;
};

// The rows by vendor, in the order each vendor first appears: [[vendor, rows], ...]
const byVendor = (rows) => {
  const groups = new Map();
  for (const t of rows) {
    if (!groups.has(t.vendor)) groups.set(t.vendor, []);
    groups.get(t.vendor).push(t);
  }
  return [...groups];
};

// A list of transactions grouped by vendor, as an account on Transactions → Accounts expands to: a
// header (select all, the bulk bar while any row is selected, the sort), then each vendor's rows with
// what went out and came in; each row its checkbox, amount, `renderMiddle(t)`, date and, on hover,
// `extraActions(t)`, Edit (in place: date, vendor, amount, notes; saved through `onEdit(id, fields)`
// with the row's own account and category) and Delete. `renderBulkActions(selected,
// clearSelection)` fills the bulk bar; `label` names the rows in the header ("Transfers (4)").
// A phone has no hover: there a tap on a row opens its actions on a line under it (the row's
// `transfer-open` class, styles/grouped-list.css), one row at a time, each action with its word.
function GroupedTransactionList({
  transactions, label, renderMiddle, renderBulkActions, onEdit, onDelete, extraActions = () => null,
}) {
  const [sort, setSort] = useState('date-desc');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [editingId, setEditingId] = useState(null);
  const [fields, setFields] = useState({});
  const [openId, setOpenId] = useState(null);

  const selected = transactions.filter(t => selectedIds.has(t.id));
  const allSelected = transactions.length > 0 && selected.length === transactions.length;
  const someSelected = selected.length > 0;
  const showYear = new Set(transactions.map(t => t.date.slice(0, 4))).size > 1;

  const toggle = (id) =>
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(transactions.map(t => t.id)));
  const clearSelection = () => setSelectedIds(new Set());

  // A tap on the row, not on its checkbox or an action, opens or closes its actions (phones)
  const toggleOpen = (e, id) => {
    if (e.target.closest('button, input, select, label, a, [role="button"]')) return;
    setOpenId(open => (open === id ? null : id));
  };

  const startEdit = (t) => {
    setOpenId(null);
    setEditingId(t.id);
    setFields({ date: t.date, vendor: t.vendor, amount: t.amount, notes: t.notes || '' });
  };
  const setField = (field, value) => setFields(prev => ({ ...prev, [field]: value }));
  const saveEdit = async (t) => {
    await onEdit(t.id, { ...fields, account_id: t.account_id, category: t.category });
    setEditingId(null);
  };

  return (
    <div className="account-transfers">
      <div className="account-transfers-header">
        <label className="bulk-select-all">
          <input
            type="checkbox"
            checked={allSelected}
            ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
            onChange={toggleAll}
            disabled={transactions.length === 0}
          />
          <span>
            {someSelected ? `${selected.length} of ${transactions.length} selected` : `${label} (${transactions.length})`}
          </span>
        </label>
        {/* idle while nothing is selected: hidden, keeping its room on a laptop, gone on a phone */}
        <div className={`transfer-bulk-bar${someSelected ? '' : ' idle'}`}>
          {renderBulkActions(selected, clearSelection)}
        </div>
        <div className="transfer-sort-controls">
          <select className="transfer-sort-select" value={sort} onChange={e => setSort(e.target.value)}>
            {SORTS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
          {sort !== 'date-desc' && (
            <button className="btn btn-ghost btn-sm" onClick={() => setSort('date-desc')}>Reset</button>
          )}
        </div>
      </div>

      {byVendor(sortRows(transactions, sort)).map(([vendor, group]) => {
        const out = group.reduce((s, t) => t.amount < 0 ? s + Math.abs(t.amount) : s, 0);
        const inn = group.reduce((s, t) => t.amount > 0 ? s + t.amount : s, 0);
        return (
          <div key={vendor} className="transfer-vendor-group">
            <div className="transfer-vendor-header">
              <span className="transfer-vendor-name">{vendor}</span>
              <span className="transfer-vendor-flows">
                {out > 0 && <span className="transfer-rel-out">${out.toFixed(2)} out</span>}
                {inn > 0 && <span className="transfer-rel-in">${inn.toFixed(2)} in</span>}
              </span>
            </div>
            {group.map(t => (
              <div
                key={t.id}
                className={`account-transfer-row${selectedIds.has(t.id) ? ' transfer-selected' : ''}${openId === t.id ? ' transfer-open' : ''}`}
                onClick={editingId === t.id ? undefined : e => toggleOpen(e, t.id)}
              >
                {editingId === t.id ? (
                  <div className="transfer-edit-row">
                    <input type="date" value={fields.date} onChange={e => setField('date', e.target.value)} />
                    <input type="text" value={fields.vendor} onChange={e => setField('vendor', e.target.value)} placeholder="Vendor" />
                    <input type="number" step="0.01" value={fields.amount} onChange={e => setField('amount', e.target.value)} placeholder="Amount" />
                    <input type="text" value={fields.notes} onChange={e => setField('notes', e.target.value)} placeholder="Notes" />
                    <button className="btn btn-primary btn-sm" onClick={() => saveEdit(t)}>Save</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                ) : (
                  <>
                    <input
                      type="checkbox"
                      className="transfer-checkbox"
                      checked={selectedIds.has(t.id)}
                      onChange={() => toggle(t.id)}
                    />
                    <span className={`account-transfer-amount ${t.amount >= 0 ? 'green' : 'red'}`}>
                      {t.amount >= 0 ? '+' : '-'}${Math.abs(t.amount).toFixed(2)}
                    </span>
                    {renderMiddle(t)}
                    <div className="account-transfer-right">
                      {/* the year a piece of its own, which a phone leaves out of an account's list */}
                      <span className="account-transfer-date">
                        {formatDate(t.date)}{showYear && <span className="transfer-date-year">, {t.date.slice(0, 4)}</span>}
                      </span>
                      <div className="transfer-row-actions">
                        {extraActions(t)}
                        <button
                          className="btn btn-ghost btn-sm icon-btn transfer-action-btn"
                          title="Edit"
                          onClick={() => startEdit(t)}
                        ><Pencil size={13} /><span className="tx-action-label">Edit</span></button>
                        <button
                          className="btn btn-danger btn-sm icon-btn transfer-action-btn"
                          title="Delete"
                          onClick={() => onDelete(t.id)}
                        ><Trash2 size={13} /><span className="tx-action-label">Delete</span></button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export default GroupedTransactionList;
