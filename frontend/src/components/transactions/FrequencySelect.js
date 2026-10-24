import { FREQUENCY_OPTIONS, frequencyValue, parseFrequencyValue } from './utils';

// Picks a recurring template's schedule from FREQUENCY_OPTIONS. A template whose schedule isn't
// one of them (made before these options, such as every 30 days) shows "Choose a schedule" and
// keeps its schedule until one is picked. onChange receives { frequency, frequency_unit }.
function FrequencySelect({ id, frequency, unit, onChange }) {
  const current = frequencyValue(frequency, unit);
  const options = FREQUENCY_OPTIONS.map(o => ({ value: frequencyValue(o.frequency, o.unit), label: o.label }));
  const isStandard = options.some(o => o.value === current);

  return (
    <select id={id} value={current} onChange={e => onChange(parseFrequencyValue(e.target.value))}>
      {!isStandard && <option value={current} disabled>Choose a schedule</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export default FrequencySelect;
