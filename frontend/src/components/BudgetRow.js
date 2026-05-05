import { useState, useEffect, useRef } from 'react';
import { useCategoryColors } from '../CategoryColorContext';

const PRESETS = [
  '#4C6EF5', '#F76707', '#2F9E44', '#E03131', '#7950F2',
  '#0CA678', '#F59F00', '#D6336C', '#1098AD', '#66A80F',
];

function BudgetRow({ item, onAmountBlur, onRolloverToggle, onDelete, hasSaveError, monthlyIncome }) {
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
  const pct = monthlyIncome > 0
    ? ((item.allocated / monthlyIncome) * 100).toFixed(0)
    : null;

  return (
    <div className={`budget-row-inline${hasSaveError ? ' has-error' : ''}`}>
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

      {pct !== null && <span className="bri-pct">{pct}%</span>}
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
        ✕
      </button>
    </div>
  );
}

export default BudgetRow;
