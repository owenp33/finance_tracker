import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { formatCents, formatSignedCents } from '../utils/money';
import { formatDate } from './transactions/utils';

// What a hit was worked out on: "6.70% a year, charged monthly, on $75,217.00 owed" on a loan,
// "0.50% a year, paid yearly, on $3,000.00" on any other account
const basis = (hit, loan) =>
  `${hit.apr.toFixed(2)}% a year, ${loan ? 'charged' : 'paid'} ${hit.frequency}, on ${formatCents(hit.base_cents)}${loan ? ' owed' : ''}`;

// An account's interest hits (GET /api/interest rows, newest first) under its row in Transactions →
// Accounts: records of their own, not transactions, so a list apart, closed at first ("Interest (2)").
// Each hit's amount can be changed to the bank's figure, typed as a positive amount (charged on a
// loan, paid on any other account); onSave(id, dollars) resolves to whether it worked, and the form
// stays open when it didn't. Nothing without hits.
function InterestHits({ hits, loan, onSave }) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [amountText, setAmountText] = useState('');
  const [saving, setSaving] = useState(false);

  if (hits.length === 0) return null;

  const save = async (hit) => {
    setSaving(true);
    const saved = await onSave(hit.id, Number(amountText));
    setSaving(false);
    if (saved) setEditingId(null);
  };

  return (
    <div className="account-interest">
      <button className="account-interest-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span aria-hidden="true">{open ? '▲' : '▼'}</span> Interest ({hits.length})
      </button>
      {open && (
        <ul className="account-interest-list">
          {hits.map(hit => {
            const date = formatDate(hit.date, true);
            return (
              <li key={hit.id} className="account-interest-row">
                <span className="account-interest-date">{date}</span>
                <span className="account-interest-basis">{basis(hit, loan)}</span>
                {editingId === hit.id ? (
                  <span className="account-interest-edit">
                    <span>{loan ? 'Charged' : 'Paid'}</span>
                    <input
                      type="number" step="0.01" min="0" value={amountText} autoFocus
                      aria-label={`Interest ${loan ? 'charged' : 'paid'} on ${date}`}
                      onChange={e => setAmountText(e.target.value)}
                    />
                    <button className="btn btn-primary btn-sm" disabled={amountText.trim() === '' || saving} onClick={() => save(hit)}>
                      Save
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                  </span>
                ) : (
                  <>
                    <span className="account-interest-amount">{formatSignedCents(hit.amount_cents)}</span>
                    <button
                      className="btn btn-ghost btn-sm icon-btn" title="Edit interest"
                      onClick={() => { setEditingId(hit.id); setAmountText((Math.abs(hit.amount_cents) / 100).toFixed(2)); }}
                    ><Pencil size={13} /></button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default InterestHits;
