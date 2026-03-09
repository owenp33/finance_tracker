import React, { useState } from 'react';

function CSVImportModal({ onImport, onClose, loading }) {
  const [csvFile, setCsvFile] = useState(null);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && file.name.endsWith('.csv')) {
      setCsvFile(file);
    } else {
      alert('Please select a valid CSV file');
      e.target.value = '';
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!csvFile) {
      alert('Please select a CSV file');
      return;
    }
    onImport(csvFile);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>Import Transactions from CSV</h3>

        <form onSubmit={handleSubmit}>
          <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '5px', marginBottom: '20px' }}>
            <p><strong>Expected CSV Format:</strong></p>
            <p style={{ fontSize: '0.9em' }}>date, vendor, category, amount, account, notes</p>
            <p style={{ fontSize: '0.85em', color: '#666', marginTop: '10px' }}>
              • Date: MM/DD/YYYY or YYYY-MM-DD<br />
              • Amount: negative for expenses, positive for income
            </p>
          </div>

          <div className="form-group">
            <label>Select CSV File:</label>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              required
            />
            {csvFile && (
              <p style={{ color: 'green', fontSize: '0.9em', marginTop: '5px' }}>
                ✓ Selected: {csvFile.name}
              </p>
            )}
          </div>

          <div className="form-actions">
            <button
              type="submit"
              className="primary-btn"
              disabled={!csvFile || loading}
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