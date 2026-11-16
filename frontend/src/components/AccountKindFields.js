// An account's type, bank or card, or loan; the add and edit forms both use it. `idPrefix` keeps
// the label's id unique.
function AccountKindFields({ idPrefix, kind, onKind }) {
  return (
    <div className="form-group">
      <label htmlFor={`${idPrefix}-kind`}>Type</label>
      <select id={`${idPrefix}-kind`} value={kind} onChange={e => onKind(e.target.value)}>
        <option value="bank">Bank or card</option>
        <option value="loan">Loan</option>
      </select>
    </div>
  );
}

export default AccountKindFields;
