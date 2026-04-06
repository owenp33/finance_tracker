import { useState } from 'react';
import { uploadFile } from '../api/client';

function CSVImportModal({ onImport, onClose, onCreateAccount, accounts, loading }) {
  const [csvFile, setCsvFile] = useState(null);
  const [csvAccounts, setCsvAccounts] = useState(null); // null = not yet previewed
  const [previewing, setPreviewing] = useState(false);
  const [creating, setCreating] = useState(null);
  const [manualAccountId, setManualAccountId] = useState('');

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file || !file.name.endsWith('.csv')) {
      alert('Please select a valid CSV file');
      e.target.value = '';
      return;
    }
    setCsvFile(file);
    setCsvAccounts(null);
    setManualAccountId('');

    // Ask the backend to parse the CSV and return unique account names
    try {
      setPreviewing(true);
      const data = await uploadFile('/api/csv/preview', file);
      setCsvAccounts(data.account_names); // [] means no account column
    } catch (err) {
      alert(`Could not preview CSV: ${err.message}`);
      setCsvFile(null);
    } finally {
      setPreviewing(false);
    }
  };

  const handleCreate = async (name) => {
    setCreating(name);
    await onCreateAccount(name, name);
    setCreating(null);
  };

  const matchAccount = (name) =>
    accounts.find(a =>
      a.account_name.toLowerCase() === name.toLowerCase() ||
      a.account_id?.toLowerCase() === name.toLowerCase()
    );

  const hasAccountCol = csvAccounts !== null && csvAccounts.length > 0;
  const allMatched = hasAccountCol && csvAccounts.every(n => matchAccount(n));
  const canImport = csvFile && !previewing && (hasAccountCol ? allMatched : !!manualAccountId);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canImport) return;
    const fallbackId = !hasAccountCol ? manualAccountId : null;
    onImport(csvFile, fallbackId);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>Import Transactions from CSV</h3>

        <div className="csv-format-info">
          <p><strong>Supported formats:</strong></p>
          <p>date, vendor, category, <em>expense</em>, <em>income</em>, account, notes</p>
          <p>date, vendor, category, <em>amount</em>, account, notes</p>
          <p className="csv-format-note">
            The <em>account</em> column is matched to your existing accounts by name.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Select CSV File</label>
            <input type="file" accept=".csv" onChange={handleFileChange} required />
            {previewing && <p className="csv-format-note">Scanning accounts…</p>}
            {csvFile && !previewing && <p className="file-selected">✓ {csvFile.name}</p>}
          </div>

          {/* Multi-account CSV: show match status for each detected name */}
          {hasAccountCol && (
            <div className="csv-account-list">
              <p className="csv-account-list-label">Accounts detected in CSV:</p>
              {csvAccounts.map(name => {
                const match = matchAccount(name);
                return (
                  <div key={name} className={`csv-account-row ${match ? 'matched' : 'unmatched'}`}>
                    <span className="csv-account-name">{name}</span>
                    {match ? (
                      <span className="csv-match-status matched">✓ {match.account_name}</span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleCreate(name)}
                        disabled={creating === name}
                      >
                        {creating === name ? 'Creating…' : '+ Create'}
                      </button>
                    )}
                  </div>
                );
              })}
              {!allMatched && (
                <p className="csv-warning">Create missing accounts to enable import.</p>
              )}
            </div>
          )}

          {/* No account column: manual fallback */}
          {csvAccounts !== null && !hasAccountCol && (
            <div className="form-group">
              <label>Import into account</label>
              <select value={manualAccountId} onChange={e => setManualAccountId(e.target.value)} required>
                <option value="">— select account —</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.account_name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={!canImport || loading}>
              {loading ? 'Importing…' : 'Import'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => { onClose(); setCsvFile(null); }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CSVImportModal;
