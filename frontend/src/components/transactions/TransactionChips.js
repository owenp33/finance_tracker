// A transaction's state as chips: over budget, a transfer (linked to its other side or not) and a
// reimbursement
function TransactionChips({ t }) {
  return (
    <>
      {t.over_budget && <span className="tx-over-chip">Over budget</span>}
      {t.is_transfer && (
        <span className={`tx-transfer-chip${t.transfer_peer_id ? '' : ' tx-transfer-unlinked'}`}
          title={t.transfer_peer_id ? undefined : 'Go to Accounts tab to link this transfer'}>
          {t.transfer_peer_id ? 'Transfer' : 'Transfer · unlinked'}
        </span>
      )}
      {t.is_reimbursement && (
        <span className="tx-reimburse-chip" title="Offsets spending in budget calculations">
          Reimbursement
        </span>
      )}
    </>
  );
}

export default TransactionChips;
