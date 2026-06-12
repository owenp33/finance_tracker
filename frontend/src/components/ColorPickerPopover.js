const PRESETS = [
  '#4C6EF5', '#F76707', '#2F9E44', '#E03131', '#7950F2',
  '#0CA678', '#F59F00', '#D6336C', '#1098AD', '#66A80F',
];

function ColorPickerPopover({ color, onSelect, onCustomChange }) {
  return (
    <div className="color-picker-popover">
      <div className="color-presets">
        {PRESETS.map(c => (
          <button
            key={c}
            className={`color-swatch${c === color ? ' selected' : ''}`}
            style={{ background: c }}
            onClick={() => onSelect(c)}
          />
        ))}
      </div>
      <div className="color-custom-row">
        <label>Custom</label>
        <input
          type="color"
          value={color}
          onChange={e => onCustomChange(e.target.value)}
        />
      </div>
    </div>
  );
}

export default ColorPickerPopover;
