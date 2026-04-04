import { useState } from 'react';

function detectAccountName(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const lines = e.target.result.split('\n').filter(l => l.trim());
      if (lines.length < 2) { resolve(null); return; }
      const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
      const colIndex = headers.indexOf('account');
      if (colIndex === -1) { resolve(null); return; }
      const names = new Set();
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const val = cols[colIndex]?.trim().replace(/"/g, '');
        if (val) names.add(val);
      }
      resolve(names.size > 0 ? [...names][0] : null);
    };
    reader.readAsText(file);
  });
}

function CSVImportModal({ onImport, onClose, onCreateAccount, accounts, loading }) {
  const [csvFile, setCsvFile] = useState(null);
  const [detectedAccount, setDetectedAccount] = useState(null);   // matched account object
  const [detectedName, setDetectedName] = useState(null);         // unmatched name from CSV
  const [manualAccountId, setManualAccountId] = useState('');
  const [creating, setCreating] = useState(false);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file || !file.name.endsWith('.csv')) {
      alert('Please select a valid CSV file');
      e.target.value = '';
      return;
    }
    setCsvFile(file);
    setDetectedAccount(null);
    setDetectedName(null);

    const name = await detectAccountName(file);
    if (!name) return;

    const match = accounts.find(a =>
      a.account_name.toLowerCase() === name.toLowerCase() ||
      a.account_id?.toLowerCase() === name.toLowerCase()
    );

    if (match) {
      setDetectedAccount(match);
    } else {
      setDetectedName(name);
    }
  };

  const handleCreate = async () => {
    setCreating(true);
    const created = await onCreateAccount(detectedName, detectedName);
    setCreating(false);
    if (created) {
      setDetectedAccount(created);
      setDetectedName(null);
    }
  };

  const resolvedAccountId = detectedAccount?.id || (manualAccountId ? parseInt(manualAccountId) : null);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!csvFile) { alert('Please select a CSV file'); return; }
    if (!resolvedAccountId) { alert('Please select or create an account for this import'); return; }
    onImport(csvFile, resolvedAccountId);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>Import Transactions from CSV</h3>

        <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '5px', marginBottom: '20px' }}>
          <p><strong>Expected CSV Format:</strong></p>
          <p style={{ fontSize: '0.9em' }}>date, vendor, category, amount, account, notes</p>
          <p style={{ fontSize: '0.85em', color: '#666', marginTop: '10px' }}>
            • Date: MM/DD/YYYY or YYYY-MM-DD<br />
            • Amount: negative for expenses, positive for income<br />
            • Account: must match an existing account name
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Select CSV File:</label>
            <input type="file" accept=".csv" onChange={handleFileChange} required />
            {csvFile && (
              <p style={{ color: 'green', fontSize: '0.9em', marginTop: '5px' }}>
                ✓ Selected: {csvFile.name}
              </p>
            )}
          </div>

          {/* Account matched from CSV */}
          {detectedAccount && (
            <div style={{ background: '#d4edda', padding: '10px', borderRadius: '5px', marginBottom: '15px' }}>
              ✓ Detected account: <strong>{detectedAccount.account_name}</strong> — will import here
            </div>
          )}

          {/* Account name found but no match */}
          {detectedName && !detectedAccount && (
            <div style={{ background: '#fff3cd', padding: '10px', borderRadius: '5px', marginBottom: '15px' }}>
              <p>Account <strong>"{detectedName}"</strong> not found.</p>
              <button
                type="button"
                className="primary-btn"
                onClick={handleCreate}
                disabled={creating}
                style={{ marginTop: '8px' }}
              >
                {creating ? 'Creating...' : `+ Create "${detectedName}"`}
              </button>
            </div>
          )}

          {/* No account column in CSV — manual selection */}
          {!detectedAccount && !detectedName && csvFile && (
            <div className="form-group">
              <label>Select Account:</label>
              <select
                value={manualAccountId}
                onChange={e => setManualAccountId(e.target.value)}
                required
              >
                <option value="">— choose account —</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.account_name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="form-actions">
            <button
              type="submit"
              className="primary-btn"
              disabled={!csvFile || !resolvedAccountId || loading}
            >
              {loading ? 'Importing...' : 'Import'}
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => { onClose(); setCsvFile(null); }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CSVImportModal;
