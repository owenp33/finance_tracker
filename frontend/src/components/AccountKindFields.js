// An account's type (bank or card, or loan) and, for a loan, its APR: the add and edit forms
// both use it. `idPrefix` keeps the labels' ids unique.
function AccountKindFields({ idPrefix, kind, onKind, apr, onApr }) {
  return (
    <>
      <div className="form-group">
        <label htmlFor={`${idPrefix}-kind`}>Type</label>
        <select id={`${idPrefix}-kind`} value={kind} onChange={e => onKind(e.target.value)}>
          <option value="bank">Bank or card</option>
          <option value="loan">Loan</option>
        </select>
      </div>
      {kind === 'loan' && (
        <div className="form-group">
          <label htmlFor={`${idPrefix}-apr`}>APR (%)</label>
          <input
            id={`${idPrefix}-apr`}
            type="number"
            step="0.01"
            value={apr}
            onChange={e => onApr(e.target.value)}
            placeholder="e.g. 6.8"
          />
          <small className="account-field-hint">
            From the loan's statement; leave it blank until you know it. A loan's balance is what you
            owe, as a negative amount.
          </small>
        </div>
      )}
    </>
  );
}

export default AccountKindFields;
