import { useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import TransactionList from '../TransactionList';
import { useRecurringSuggestions } from '../../hooks/useRecurringSuggestions';
import { formatDate } from './utils';

const KIND_LABELS = {
  history:   'Before this series started',
  missing:   'Nothing linked for this date',
  duplicate: 'Possible duplicate or unrelated transaction',
};

// Transactions that may belong to a recurring template, grouped by the occurrence they'd fill,
// in the same rows as the template's generated transactions (actions appear on hover). A
// 'duplicate' sits next to an occurrence the series already covers, which is shown above it;
// it's left out of "Link all" for the user to decide.
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

  const actionsFor = (kind) => (t) => (
    <>
      <button className="btn btn-ghost btn-sm icon-btn series-link-btn" disabled={busy}
              title="Link to series" aria-label="Link to series"
              onClick={() => run(() => onLink(template.id, [t.id]))}>
        <Check size={14} />
      </button>
      <button className="btn btn-ghost btn-sm icon-btn suggestion-unrelated-btn" disabled={busy}
              title="Unrelated transaction" aria-label="Unrelated transaction"
              onClick={() => run(() => onDismiss(template.id, t.id))}>
        <span aria-hidden="true">∉</span>
      </button>
      {kind === 'duplicate' && (
        <button className="btn btn-danger btn-sm icon-btn" disabled={busy}
                title="Delete duplicate" aria-label="Delete duplicate"
                onClick={() => run(() => onDelete(t.id))}>
          <Trash2 size={14} />
        </button>
      )}
    </>
  );

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
          {s.kind === 'duplicate' && s.linked.length > 0 && (
            <div className="recurring-suggestion-series">
              <small>In the series</small>
              <TransactionList transactions={s.linked} renderActions={() => null} />
            </div>
          )}
          <TransactionList transactions={s.candidates} renderActions={actionsFor(s.kind)} />
        </div>
      ))}
    </div>
  );
}

export default RecurringSuggestions;
