import { useState } from 'react';
import { Check, Pencil, Trash2 } from 'lucide-react';
import { formatCents, formatSignedCents } from '../utils/money';
import { formatDate } from './transactions/utils';

// What a charge was worked out on: "6.70% a year, charged monthly, on $75,217.00 owed" on a loan,
// "0.50% a year, paid yearly, on $3,000.00" on any other account
const basis = (hit, loan) =>
  `${hit.apr.toFixed(2)}% a year, ${loan ? 'charged' : 'paid'} ${hit.frequency}, on ${formatCents(hit.base_cents)}${loan ? ' owed' : ''}`;

// An account's interest waiting for approval (its GET /api/interest rows not yet approved) under its
// row in Transactions → Accounts, oldest first, the order to approve them in: records of their own,
// not transactions. Each can be changed to the bank's figure (typed as a positive amount: charged on
// a loan, paid on any other account), approved (it then moves the balance and leaves the list) or
// deleted once confirmed (it won't be booked again); "Approve all" approves them in the same order.
// onSave(id, dollars), onApprove(ids) and onDelete(id) resolve to whether they worked, and an edit
// stays open when it didn't. Nothing when none are waiting.
function InterestHits({ hits, loan, onSave, onApprove, onDelete }) {
  const [editingId, setEditingId] = useState(null);
  const [amountText, setAmountText] = useState('');
  const [busy, setBusy] = useState(false);

  if (hits.length === 0) return null;
  const oldestFirst = [...hits].sort((a, b) => a.date.localeCompare(b.date));

  // One change at a time, so a second click can't send it twice
  const run = async (change) => {
    setBusy(true);
    const worked = await change();
    setBusy(false);
    return worked;
  };
  const save = async (hit) => {
    if (await run(() => onSave(hit.id, Number(amountText)))) setEditingId(null);
  };
  const remove = (hit, date) => {
    if (window.confirm(`Delete the interest for ${date} (${formatSignedCents(hit.amount_cents)})? It won't be booked again.`)) {
      run(() => onDelete(hit.id));
    }
  };

  return (
    <div className="account-interest">
      <div className="account-interest-heading">
        <span>Interest to approve ({hits.length})</span>
        {hits.length > 1 && (
          <button className="btn btn-secondary btn-sm" disabled={busy}
                  onClick={() => run(() => onApprove(oldestFirst.map(hit => hit.id)))}>
            Approve all
          </button>
        )}
      </div>
      <ul className="account-interest-list">
        {oldestFirst.map(hit => {
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
                  <button className="btn btn-primary btn-sm" disabled={amountText.trim() === '' || busy} onClick={() => save(hit)}>
                    Save
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                </span>
              ) : (
                <>
                  <span className="account-interest-amount">{formatSignedCents(hit.amount_cents)}</span>
                  <span className="account-interest-actions">
                    <button className="btn btn-ghost btn-sm icon-btn series-link-btn" title="Approve interest" disabled={busy}
                            onClick={() => run(() => onApprove([hit.id]))}><Check size={14} /></button>
                    <button
                      className="btn btn-ghost btn-sm icon-btn" title="Edit interest" disabled={busy}
                      onClick={() => { setEditingId(hit.id); setAmountText((Math.abs(hit.amount_cents) / 100).toFixed(2)); }}
                    ><Pencil size={13} /></button>
                    <button className="btn btn-danger btn-sm icon-btn" title="Delete interest" disabled={busy}
                            onClick={() => remove(hit, date)}><Trash2 size={13} /></button>
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default InterestHits;
