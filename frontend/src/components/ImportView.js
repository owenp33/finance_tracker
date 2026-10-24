import { useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { previewImport, confirmImport } from '../api/imports';

// A row can be imported with an account (existing, or created on import) and a readable,
// non-zero date and amount
const canSelect = (row) =>
  (row.account_id !== null || row.new_account)
  && !row.zero_amount && !row.invalid_date && !row.invalid_amount;

// Pre-selected: importable rows that aren't already in the database
const selectedByDefault = (row) => canSelect(row) && !row.duplicate;

// Why a row can't be imported, or isn't pre-selected; shown when hovering its checkbox
const rowIssue = (row) => {
  if (row.invalid_date)   return 'Unreadable date';
  if (row.invalid_amount) return 'Unreadable amount';
  if (row.zero_amount)    return 'Zero amount';
  if (row.account_id === null && !row.new_account) return 'No matching account';
  if (row.duplicate)      return 'Already in your transactions';
  return undefined;
};

// The "When an account isn't found" dropdown value: 'create', 'skip', or 'account:<id>'
const parseUnmatchedChoice = (choice) =>
  choice.startsWith('account:')
    ? { unmatched: 'account', targetAccountId: choice.slice('account:'.length) }
    : { unmatched: choice, targetAccountId: null };

function ImportView({ accounts, onImportDone, onNavigateAway }) {
  const [step, setStep]               = useState('pick');
  const [file, setFile]               = useState(null);
  const [unmatchedChoice, setUnmatchedChoice] = useState('create');
  const [rows, setRows]               = useState([]);
  const [summary, setSummary]         = useState(null);
  const [selected, setSelected]       = useState(new Set());
  const [loading, setLoading]         = useState(false);
  const [successMsg, setSuccessMsg]   = useState('');

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    const allowed = ['.csv', '.xlsx', '.xls'];
    if (!f || !allowed.some(ext => f.name.toLowerCase().endsWith(ext))) {
      alert('Please select a CSV or Excel file (.csv, .xlsx, .xls)');
      e.target.value = '';
      return;
    }
    setFile(f);
    setSuccessMsg('');
  };

  const handlePreview = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const data = await previewImport(file, parseUnmatchedChoice(unmatchedChoice));
      setRows(data.rows);
      setSummary(data.summary);
      setSelected(new Set(
        data.rows
          .map((r, i) => (selectedByDefault(r) ? i : null))
          .filter(i => i !== null)
      ));
      setStep('preview');
    } catch (err) {
      alert(`Preview failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const toggleRow = (i) =>
    setSelected(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const toggleRowTransfer = (i) =>
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, is_transfer: !r.is_transfer } : r));

  const handleConfirm = async () => {
    const toImport = rows.filter((_, i) => selected.has(i));
    if (toImport.length === 0) return;
    setLoading(true);
    try {
      const data = await confirmImport(toImport);
      setSuccessMsg(data.message);
      onImportDone();
      reset();
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStep('pick');
    setFile(null);
    setUnmatchedChoice('create');
    setRows([]);
    setSummary(null);
    setSelected(new Set());
  };

  return (
    <div>
      <div className="view-header"><h2>Import Transactions</h2></div>

      {successMsg && (
        <div className="import-success">
          <span>✓ {successMsg}</span>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => { setSuccessMsg(''); onNavigateAway(); }}
          >
            View Transactions →
          </button>
        </div>
      )}

      {step === 'pick' && (
        <div className="import-pick">
          <div className="csv-format-info">
            <p><strong>Accepted files:</strong> .csv, .xlsx, .xls</p>
            <p><strong>Supported column layouts:</strong></p>
            <p>date, vendor, category, <em>expense/withdrawal</em>, <em>income/deposit</em>, account, notes/description</p>
            <p>date, vendor, category, <em>amount</em>, account, notes/description</p>
            <p className="csv-format-note">
              The <em>account</em> column is matched to your accounts by name or account ID.
            </p>
          </div>

          <div className="form-group">
            <label>Select File</label>
            <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} />
            {file && <p className="file-selected">✓ {file.name}</p>}
          </div>

          {file && (
            <div className="form-group">
              <label htmlFor="import-unmatched">When an account isn't found</label>
              <select
                id="import-unmatched"
                value={unmatchedChoice}
                onChange={e => setUnmatchedChoice(e.target.value)}
              >
                <option value="create">Create accounts automatically</option>
                {accounts.map(a => (
                  <option key={a.id} value={`account:${a.id}`}>{`Put rows into ${a.account_name}`}</option>
                ))}
                <option value="skip">Skip those rows</option>
              </select>
              {unmatchedChoice === 'create' && (
                <p className="csv-format-note">
                  New accounts are marked “Needs attention” in Accounts so you can review them.
                </p>
              )}
            </div>
          )}

          <div className="form-actions">
            <button className="btn btn-primary" onClick={handlePreview} disabled={!file || loading}>
              {loading ? 'Scanning…' : 'Preview'}
            </button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="import-preview">
          {summary && (
            <div className="import-summary">
              <span>{summary.total} total</span>
              <span className="green">{summary.importable} importable</span>
              {summary.duplicates  > 0 && <span className="red">{summary.duplicates} duplicate{summary.duplicates !== 1 ? 's' : ''}</span>}
              {summary.unmatched   > 0 && <span className="orange">{summary.unmatched} unmatched</span>}
              {summary.zero_amount > 0 && <span className="orange">{summary.zero_amount} zero-amount</span>}
              {summary.invalid_date > 0 && <span className="orange">{summary.invalid_date} invalid date{summary.invalid_date !== 1 ? 's' : ''}</span>}
              {summary.invalid_amount > 0 && <span className="orange">{summary.invalid_amount} invalid amount{summary.invalid_amount !== 1 ? 's' : ''}</span>}
              {summary.new_accounts?.length > 0 && (
                <span className="green">
                  {summary.new_accounts.length} new account{summary.new_accounts.length !== 1 ? 's' : ''}
                </span>
              )}
              <span className="count-badge">{selected.size} selected</span>
            </div>
          )}

          {summary?.new_accounts?.length > 0 && (
            <p className="csv-format-note">
              New accounts will be created: {summary.new_accounts.join(', ')}. They're marked
              “Needs attention” in Accounts so you can rename them.
            </p>
          )}

          <div className="form-actions import-actions-top">
            <button className="btn btn-primary" onClick={handleConfirm} disabled={selected.size === 0 || loading}>
              {loading ? 'Importing…' : `Import ${selected.size} row${selected.size !== 1 ? 's' : ''}`}
            </button>
            <button className="btn btn-ghost" onClick={reset}>← Back</button>
          </div>

          <div className="import-table-wrap">
            <table className="import-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Date</th><th>Vendor</th><th>Category</th>
                  <th>Amount</th><th>Account</th><th>Notes</th><th>Transfer</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...rows.map((_, i) => i).filter(i => selected.has(i)),
                  ...rows.map((_, i) => i).filter(i => !selected.has(i)),
                ].map(i => {
                  const row = rows[i];
                  const rowClass = [
                    'import-row',
                    row.duplicate    ? 'duplicate'   : '',
                    row.zero_amount  ? 'zero-amount' : '',
                    row.invalid_date ? 'invalid-date' : '',
                    row.invalid_amount ? 'invalid-amount' : '',
                    row.account_id === null && !row.new_account ? 'unmatched' : '',
                    !selected.has(i) ? 'deselected'  : '',
                  ].filter(Boolean).join(' ');
                  return (
                    <tr key={i} className={rowClass}>
                      <td title={rowIssue(row)}>
                        <input
                          type="checkbox"
                          checked={selected.has(i)}
                          onChange={() => toggleRow(i)}
                          disabled={!canSelect(row)}
                        />
                      </td>
                      <td>
                        {row.invalid_date
                          ? <span className="csv-warning" title="Unrecognized date">{row.date || 'missing'}</span>
                          : row.date}
                      </td>
                      <td>{row.vendor}</td>
                      <td>{row.category}</td>
                      {row.invalid_amount ? (
                        <td>
                          <span className="csv-warning" title="Unrecognized amount">{row.amount || 'missing'}</span>
                        </td>
                      ) : (
                        <td className={row.amount >= 0 ? 'green' : 'red'}>
                          {row.amount >= 0 ? '+' : '−'}${Math.abs(row.amount).toFixed(2)}
                        </td>
                      )}
                      <td>
                        {row.account_name ?? <span className="csv-warning">unmatched</span>}
                        {row.new_account && <span className="new-account-badge">new</span>}
                      </td>
                      <td><small>{row.notes}</small></td>
                      <td>
                        <button
                          className={`import-transfer-toggle${row.is_transfer ? ' active' : ''}`}
                          title={row.is_transfer ? 'Unmark as transfer' : 'Mark as transfer'}
                          onClick={() => toggleRowTransfer(i)}
                        >
                          <ArrowLeftRight size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="form-actions">
            <button className="btn btn-primary" onClick={handleConfirm} disabled={selected.size === 0 || loading}>
              {loading ? 'Importing…' : `Import ${selected.size} row${selected.size !== 1 ? 's' : ''}`}
            </button>
            <button className="btn btn-ghost" onClick={reset}>← Back</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ImportView;
