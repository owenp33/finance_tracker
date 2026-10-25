import { useState } from 'react';
import { useRecurringSuggestions } from '../../hooks/useRecurringSuggestions';
import { formatDollars } from '../../utils/money';
import { formatDate } from './utils';

const KIND_LABELS = {
  history:   'Before this series started',
  missing:   'Nothing linked for this date',
  duplicate: 'Possible duplicate or extra payment',
};

// Transactions that may belong to a recurring template, grouped by the occurrence they'd fill.
// A 'duplicate' sits next to an occurrence the series already covers: it's either the same charge
// twice (delete it) or an extra payment that belongs to the series too (link it), so it's left
// out of "Link all" for the user to decide.
function RecurringSuggestions({ template, onLink, onDismiss, onDelete }) {
  const { suggestions, error } = useRecurringSuggestions(template.id, template.suggestion_count);
  const [busy, setBusy] = useState(false);

  const run = async (action) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="csv-warning">{error}</p>;
  if (suggestions === null) return <p className="no-data">Looking for matches…</p>;
  if (suggestions.length === 0) return <p className="no-data">Nothing left to review.</p>;

  const linkable = suggestions
    .filter(s => s.kind !== 'duplicate')
    .flatMap(s => s.candidates.map(t => t.id));

  const linkAll = () => {
    if (!window.confirm(`Link all ${linkable.length} suggested transactions to ${template.vendor}?`)) return;
    run(() => onLink(template.id, linkable));
  };

  return (
    <div className="recurring-suggestions">
      {linkable.length > 1 && (
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={linkAll}>
          Link all {linkable.length}
        </button>
      )}
      {suggestions.map(s => (
        <div key={s.date} className="recurring-suggestion">
          <div className="recurring-suggestion-head">
            {formatDate(s.date, true)} · {KIND_LABELS[s.kind]}
          </div>
          {s.kind === 'duplicate' && s.linked.map(t => (
            <div key={t.id} className="recurring-suggestion-linked">
              In the series: {formatDate(t.date, true)} · {formatDollars(t.amount)}
            </div>
          ))}
          {s.candidates.map(t => (
            <div key={t.id} className="recurring-suggestion-row">
              <span>{formatDate(t.date, true)}</span>
              <span className="recurring-suggestion-vendor">{t.vendor} · {t.category}</span>
              <span className={t.amount >= 0 ? 'green' : 'red'}>{formatDollars(t.amount)}</span>
              <span className="recurring-suggestion-actions">
                {s.kind === 'duplicate' ? (
                  <>
                    <button className="btn btn-secondary btn-sm" disabled={busy}
                            onClick={() => run(() => onLink(template.id, [t.id]))}>Link as extra payment</button>
                    <button className="btn btn-danger btn-sm" disabled={busy}
                            onClick={() => run(() => onDelete(t.id))}>Delete duplicate</button>
                  </>
                ) : (
                  <button className="btn btn-secondary btn-sm" disabled={busy}
                          onClick={() => run(() => onLink(template.id, [t.id]))}>Link</button>
                )}
                <button className="btn btn-ghost btn-sm" disabled={busy}
                        onClick={() => run(() => onDismiss(template.id, t.id))}>Not part of this</button>
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default RecurringSuggestions;
