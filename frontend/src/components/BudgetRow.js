import { useState, useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { useCategoryColors } from '../CategoryColorContext';
import BudgetProgressBar from './BudgetProgressBar';
import BudgetTransactionList from './BudgetTransactionList';
import ColorPickerPopover from './ColorPickerPopover';

function BudgetRow({
  item,
  onAmountBlur,
  onRolloverToggle,
  onDelete,
  hasSaveError,
  monthlyIncome,
  categoryTransactions = [],
}) {
  const [localAmount, setLocalAmount] = useState(item.allocated.toFixed(2));
  const [pickerOpen, setPickerOpen] = useState(false);
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

  return (
    <div className={`budget-row-card${hasSaveError ? ' has-error' : ''}`}>

      <div className="budget-row-inline">
        <div className="bri-dot-wrap" ref={pickerRef}>
          <span
            className="bri-dot"
            style={{ background: color }}
            onClick={() => setPickerOpen(o => !o)}
            title="Change color"
          />
          {pickerOpen && (
            <ColorPickerPopover
              color={color}
              onSelect={(c) => { setColor(item.category, c); setPickerOpen(false); }}
              onCustomChange={(c) => setColor(item.category, c)}
            />
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

      <BudgetProgressBar item={item} showCategory={false} compact />

      <BudgetTransactionList transactions={categoryTransactions} />

    </div>
  );
}

export default BudgetRow;
