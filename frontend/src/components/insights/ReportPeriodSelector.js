import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PERIOD_MODES, stepPeriod, formatPeriodLabel } from './reportPeriod';

const MODE_LABELS = {
  all: 'All Time',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
  custom: 'Custom',
};

/**
 * Calendar-aligned period selector for the Reports tab.
 * Reusable elsewhere later — takes no ReportsTab-specific props.
 */
function ReportPeriodSelector({ mode, period, onModeChange, onPeriodChange }) {
  const showNav = mode === 'monthly' || mode === 'quarterly' || mode === 'annual';

  return (
    <div className="report-period-selector">
      <div className="preset-pills">
        {PERIOD_MODES.map(key => (
          <button
            key={key}
            className={`preset-pill${mode === key ? ' active' : ''}`}
            onClick={() => onModeChange(key)}
          >{MODE_LABELS[key]}</button>
        ))}
      </div>
      {showNav && period && (
        <div className="report-period-nav">
          <button
            className="report-period-nav-btn"
            aria-label="Previous period"
            onClick={() => onPeriodChange(stepPeriod(period, -1))}
          ><ChevronLeft size={16} /></button>
          <span className="report-period-label">{formatPeriodLabel(mode, period)}</span>
          <button
            className="report-period-nav-btn"
            aria-label="Next period"
            onClick={() => onPeriodChange(stepPeriod(period, 1))}
          ><ChevronRight size={16} /></button>
        </div>
      )}
    </div>
  );
}

export default ReportPeriodSelector;
