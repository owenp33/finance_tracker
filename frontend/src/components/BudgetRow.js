import { useState, useEffect, useRef } from 'react';
import { Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { useCategoryColors } from '../CategoryColorContext';

const PRESETS = [
  '#4C6EF5', '#F76707', '#2F9E44', '#E03131', '#7950F2',
  '#0CA678', '#F59F00', '#D6336C', '#1098AD', '#66A80F',
];

const formatDate = (dateStr) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

function BudgetRow({ item, onAmountBlur, onRolloverToggle, onDelete, hasSaveError, monthlyIncome, transactions = [], period }) {
  const [localAmount, setLocalAmount] = useState(item.allocated.toFixed(2));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const pickerRef = useRef(null);
  const { getColor, setColor } = useCategoryColors();

  useEffect(() => {
    setLocalAmount(item.allocated.toFixed(2));
  }, [item.allocated]);

  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pickerOpen]);

  const handleBlur = () => {
    const parsed = parseFloat(localAmount);
    if (isNaN(parsed) || parsed < 0) {
      setLocalAmount(item.allocated.toFixed(2));
      return;
    }
    if (parsed === item.allocated) return;
    onAmountBlur(item, parsed);
  };

  const color = getColor(item.category);

  const incomePct = monthlyIncome > 0
    ? ((item.allocated / monthlyIncome) * 100).toFixed(0)
    : null;

  const total = item.allocated + (item.carried_over || 0);
  const usedPct = total > 0 ? Math.min((item.spent / total) * 100, 100) : 0;
  const displayPct = total > 0 ? Math.round((item.spent / total) * 100) : 0;

  const categoryTxs = transactions
    .filter(t => t.category === item.category && t.date.startsWith(period))
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className={`budget-row-card${hasSaveError ? ' has-error' : ''}`}>

      {/* Controls row */}
      <div className="budget-row-inline">
        <div className="bri-dot-wrap" ref={pickerRef}>
          <span
            className="bri-dot"
            style={{ background: color }}
            onClick={() => setPickerOpen(o => !o)}
            title="Change color"
          />
          {pickerOpen && (
            <div className="color-picker-popover">
              <div className="color-presets">
                {PRESETS.map(c => (
                  <button
                    key={c}
                    className={`color-swatch${c === color ? ' selected' : ''}`}
                    style={{ background: c }}
                    onClick={() => { setColor(item.category, c); setPickerOpen(false); }}
                  />
                ))}
              </div>
              <div className="color-custom-row">
                <label>Custom</label>
                <input
                  type="color"
                  value={color}
                  onChange={e => setColor(item.category, e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <span className="bri-category">{item.category}</span>

        <div className="bri-amount-wrap">
          <span className="bri-prefix">$</span>
          <input
            type="number"
            step="0.01"
            min="0"
            className="bri-amount-input"
            value={localAmount}
            onChange={e => setLocalAmount(e.target.value)}
            onBlur={handleBlur}
            aria-label={`Monthly allocation for ${item.category}`}
          />
        </div>

        {incomePct !== null && <span className="bri-pct">{incomePct}%</span>}
        {hasSaveError && <span className="bri-error">Save failed</span>}

        <label className="bri-rollover">
          <input
            type="checkbox"
            checked={item.rollover}
            onChange={() => onRolloverToggle(item)}
          />
          Rollover
        </label>

        <button
          className="btn btn-danger btn-sm bri-delete"
          onClick={() => onDelete(item)}
          aria-label={`Remove ${item.category} budget`}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Progress bar */}
      <div className="bri-progress">
        <div className="bri-bar-track">
          <div
            className={`bri-bar-fill${item.over_budget ? ' over' : ''}`}
            style={{ width: `${usedPct}%`, ...(!item.over_budget && { background: color }) }}
          />
        </div>
        <div className="bri-bar-meta">
          <span className={item.over_budget ? 'over' : ''}>
            {item.over_budget
              ? `$${Math.abs(item.remaining).toFixed(2)} over budget`
              : `$${item.remaining.toFixed(2)} remaining`}
          </span>
          <span className={item.over_budget ? 'over' : ''}>
            ${item.spent.toFixed(2)} / ${total.toFixed(2)} · {displayPct}%
          </span>
        </div>
      </div>

      {/* Expand transactions */}
      {categoryTxs.length > 0 && (
        <button className="bri-expand-btn" onClick={() => setExpanded(e => !e)}>
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {categoryTxs.length} transaction{categoryTxs.length !== 1 ? 's' : ''}
        </button>
      )}

      {expanded && (
        <div className="bri-tx-list">
          {categoryTxs.map(t => (
            <div key={t.id} className="bri-tx-item">
              <div className="bri-tx-info">
                <span className="bri-tx-vendor">{t.vendor}</span>
                <span className="bri-tx-date">
                  {formatDate(t.date)}{t.notes ? ` · ${t.notes}` : ''}
                </span>
              </div>
              <div className="bri-tx-right">
                {t.over_budget && <span className="tx-over-chip">Over budget</span>}
                {t.is_reimbursement && <span className="tx-reimburse-chip">Reimbursement</span>}
                <span className={`bri-tx-amount ${t.amount >= 0 ? 'green' : 'red'}`}>
                  {t.amount >= 0 ? '+' : '-'}${Math.abs(t.amount).toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}

export default BudgetRow;
