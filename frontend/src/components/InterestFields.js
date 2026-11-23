// An account's interest: its yearly rate (blank for none) and, once there's a rate, how often it
// hits (monthly, quarterly or yearly, on the 1st of each period). A loan is charged on what it
// owes; any other account is paid on a positive balance. The add and edit forms both use it.
function InterestFields({ idPrefix, kind, apr, onApr, frequency, onFrequency }) {
  return (
    <>
      <div className="form-group">
        <label htmlFor={`${idPrefix}-apr`}>APR (% a year)</label>
        <input
          id={`${idPrefix}-apr`}
          type="number"
          step="0.01"
          value={apr}
          onChange={e => onApr(e.target.value)}
          placeholder={kind === 'loan' ? 'e.g. 6.7' : 'e.g. 0.5'}
        />
        <small className="account-field-hint">
          {kind === 'loan'
            ? "Charged on what's owed. Blank if unknown."
            : 'Paid on a positive balance. Blank if none.'}
        </small>
      </div>
      {apr.trim() !== '' && (
        <div className="form-group">
          <label htmlFor={`${idPrefix}-frequency`}>How often</label>
          <select id={`${idPrefix}-frequency`} value={frequency} onChange={e => onFrequency(e.target.value)}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
          </select>
          <small className="account-field-hint">
            On the 1st of each month, quarter or year.
          </small>
        </div>
      )}
    </>
  );
}

export default InterestFields;
