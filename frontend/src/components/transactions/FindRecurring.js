import { useState } from 'react';
import TransactionList from '../TransactionList';
import { useDetectedSeries } from '../../hooks/useDetectedSeries';
import { formatDate, frequencyLabel } from './utils';

// Where a found series stands: still going (and when it comes due next), or over
const statusLabel = (series) => {
  const lastPaid = series.transactions[series.transactions.length - 1].date;
  return series.ongoing
    ? `Ongoing · next ${formatDate(series.next_date, true)}`
    : `Ended · last paid ${formatDate(lastPaid, true)}`;
};

// Recurring series hiding among the user's transactions, shown like the templates. "Add series"
// makes one a template linked to its payments (an ended one becomes a finished record that never
// adds transactions); "Not recurring" hides it for good. The list is fetched again after either.
function FindRecurring({ accounts, onAdd, onDismiss }) {
  const { series, error, reload } = useDetectedSeries();
  const [expandedKeys, setExpandedKeys] = useState(new Set());
  const [busy, setBusy] = useState(false);

  const run = async (action) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
      reload();
    }
  };

  const toggleExpanded = (key) =>
    setExpandedKeys(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });

  const dismiss = (s, ids) => {
    if (!window.confirm(`Hide ${s.vendor} for good? It won't be suggested again.`)) return;
    run(() => onDismiss(ids));
  };

  return (
    <div className="find-recurring">
      <h3>Found series</h3>
      <p className="csv-format-note">
        Payments that repeat on a schedule and aren't in a recurring series yet. Adding one links
        its payments to a new template; an ended series is kept as a finished record and never
        adds transactions.
      </p>
      {error && <p className="csv-warning">{error}</p>}
      {!error && series === null && <p className="no-data">Looking for recurring series…</p>}
      {!error && series?.length === 0 && <p className="no-data">No new recurring series found.</p>}
      {!error && series?.map(s => {
        // A transaction belongs to one series at most, so its first payment names it
        const key = s.transactions[0].id;
        const ids = s.transactions.map(t => t.id);
        const account = accounts.find(a => a.id === s.account_id);
        const isExpanded = expandedKeys.has(key);
        return (
          <div key={key} className="recurring-item">
            <div className="recurring-item-row">
              <div className="recurring-info">
                <strong>{s.vendor}</strong>
                <span>
                  {s.category} · {frequencyLabel(s.frequency, s.frequency_unit)} · {ids.length} payments
                  {account ? ` · ${account.account_name}` : ''}
                </span>
                <small>{statusLabel(s)}</small>
              </div>
              <div className="recurring-item-right">
                <span className={`transaction-amount ${s.amount >= 0 ? 'green' : 'red'}`}>
                  {s.amount >= 0 ? '+' : '-'}${Math.abs(s.amount).toFixed(2)}
                </span>
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => onAdd(ids))}>
                  Add series
                </button>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => dismiss(s, ids)}>
                  Not recurring
                </button>
              </div>
            </div>
            <div className="recurring-generated">
              <button className="recurring-generated-toggle" onClick={() => toggleExpanded(key)}>
                {isExpanded ? '▲' : '▼'} {ids.length} payments
              </button>
              {isExpanded && (
                <div className="recurring-generated-list">
                  <TransactionList transactions={[...s.transactions].reverse()} renderActions={() => null} />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default FindRecurring;
