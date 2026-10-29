import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

const formatDate = (dateStr) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
};

function BudgetTransactionList({ transactions }) {
  const [expanded, setExpanded] = useState(false);

  if (!transactions || transactions.length === 0) return null;

  return (
    <>
      <button className="bri-expand-btn" onClick={() => setExpanded(e => !e)}>
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {transactions.length} transaction{transactions.length !== 1 ? 's' : ''}
      </button>

      {expanded && (
        <div className="bri-tx-list">
          {transactions.map(t => (
            <div key={t.id} className="bri-tx-item">
              <div className="bri-tx-info">
                <span className="bri-tx-vendor">{t.vendor}</span>
                <span className="bri-tx-date">
                  {formatDate(t.date)}{t.notes ? ` · ${t.notes}` : ''}
                </span>
              </div>
              <div className="bri-tx-right">
                {t.over_budget && (
                  <span className="tx-over-chip">Over budget</span>
                )}
                {t.is_reimbursement && (
                  <span className="tx-reimburse-chip">Reimbursement</span>
                )}
                <span className={`bri-tx-amount ${t.amount >= 0 ? 'green' : 'red'}`}>
                  {t.amount >= 0 ? '+' : '-'}${Math.abs(t.amount).toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default BudgetTransactionList;
