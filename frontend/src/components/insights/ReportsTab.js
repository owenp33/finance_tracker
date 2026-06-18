import React, { useState, useMemo } from 'react';
import FilterPanel from '../FilterPanel';
import { exportTransactionsCSV, exportReportPDF } from '../../api/export';
import { PRESETS, presetDates } from './analytics';

function ReportsTab({ transactions = [], accounts = [] }) {
  const [startDate,          setStartDate]          = useState('');
  const [endDate,            setEndDate]            = useState('');
  const [selectedAccountIds, setSelectedAccountIds] = useState(new Set());
  const [selectedCategories, setSelectedCategories] = useState(new Set());
  const [datePreset,         setDatePreset]         = useState('all');
  const [downloading,        setDownloading]        = useState(null); // 'csv' | 'pdf' | null
  const [downloadError,      setDownloadError]      = useState(null);

  const allCategories = useMemo(
    () => [...new Set(transactions.map(t => t.category))].sort(),
    [transactions],
  );

  const applyPreset = (preset) => {
    const { start, end } = presetDates(preset);
    setDatePreset(preset);
    setStartDate(start);
    setEndDate(end);
  };

  const toggle = (setter, val) => setter(prev => {
    const next = new Set(prev);
    next.has(val) ? next.delete(val) : next.add(val);
    return next;
  });

  const clearFilters = () => {
    applyPreset('all');
    setSelectedAccountIds(new Set());
    setSelectedCategories(new Set());
  };

  const dateActive = !!(startDate || endDate);
  const activeFilterCount =
    (dateActive ? 1 : 0) +
    (selectedAccountIds.size > 0 ? 1 : 0) +
    (selectedCategories.size > 0 ? 1 : 0);

  const handleDownload = async (kind) => {
    setDownloadError(null);
    setDownloading(kind);
    try {
      const filters = {
        accountIds: [...selectedAccountIds],
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        categories: [...selectedCategories],
      };
      if (kind === 'csv') await exportTransactionsCSV(filters);
      else                await exportReportPDF(filters);
    } catch (err) {
      setDownloadError(err.message);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="insights-header-card">
      <div className="view-header">
        <h2>Reports</h2>
        <div className="view-header-actions">
          <button
            className="btn btn-secondary"
            onClick={() => handleDownload('csv')}
            disabled={downloading !== null}
          >
            {downloading === 'csv' ? 'Exporting…' : 'Export Transactions CSV'}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => handleDownload('pdf')}
            disabled={downloading !== null}
          >
            {downloading === 'pdf' ? 'Generating…' : 'Download PDF'}
          </button>
        </div>
      </div>

      {downloadError && <p className="error-message">{downloadError}</p>}

      <FilterPanel
        accounts={accounts}
        selectedAccountIds={selectedAccountIds}
        onAccountToggle={(id) => toggle(setSelectedAccountIds, id)}
        onAccountSelectAll={() => setSelectedAccountIds(new Set(accounts.map(a => a.id)))}
        onAccountClear={() => setSelectedAccountIds(new Set())}
        allCategories={allCategories}
        selectedCategories={selectedCategories}
        onCategoryToggle={(cat) => toggle(setSelectedCategories, cat)}
        onCategorySelectAll={() => setSelectedCategories(new Set(allCategories))}
        onCategoryClear={() => setSelectedCategories(new Set())}
        dateSectionLabel="Period"
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={(val) => { setStartDate(val); setDatePreset('custom'); }}
        onEndDateChange={(val) => { setEndDate(val); setDatePreset('custom'); }}
        showDateClear={dateActive}
        onDateClear={() => applyPreset('all')}
        presets={PRESETS}
        datePreset={datePreset}
        onPresetChange={applyPreset}
        activeFilterCount={activeFilterCount}
        onClearAll={clearFilters}
      />
    </div>
  );
}

export default ReportsTab;
