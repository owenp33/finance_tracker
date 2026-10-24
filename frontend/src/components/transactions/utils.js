// Shared helpers used by AllTransactionsTab, RecurringTab, and FlaggedTab.

export const PAGE_SIZE = 10;

export const dateStrToDate = (dateStr) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export const formatDate = (dateOrStr, includeYear = false) => {
  const dt = typeof dateOrStr === 'string' ? dateStrToDate(dateOrStr) : dateOrStr;
  const opts = { month: 'short', day: 'numeric' };
  if (includeYear) opts.year = 'numeric';
  return dt.toLocaleDateString('en-US', opts);
};

// The repeat schedules offered for recurring templates: every N days or N calendar months
export const FREQUENCY_OPTIONS = [
  { frequency: 7,  unit: 'days',   label: 'Weekly' },
  { frequency: 14, unit: 'days',   label: 'Biweekly' },
  { frequency: 1,  unit: 'months', label: 'Monthly' },
  { frequency: 3,  unit: 'months', label: 'Quarterly' },
  { frequency: 12, unit: 'months', label: 'Annually' },
];

// A schedule as one <select> value ("1:months") and back
export const frequencyValue = (frequency, unit) => `${frequency}:${unit}`;
export const parseFrequencyValue = (value) => {
  const [frequency, unit] = value.split(':');
  return { frequency: Number(frequency), frequency_unit: unit };
};

export const frequencyLabel = (frequency, unit) => {
  const option = FREQUENCY_OPTIONS.find(o => o.frequency === frequency && o.unit === unit);
  if (option) return option.label;
  const noun = unit === 'months' ? 'month' : 'day';
  return `Every ${frequency} ${noun}${frequency === 1 ? '' : 's'}`;
};

export function getMonthRange(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDate = new Date(year, month, 0).getDate();
  const last = `${year}-${String(month).padStart(2, '0')}-${String(lastDate).padStart(2, '0')}`;
  return [first, last];
}

export function getPeriodLabel(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) return 'All Time';
  const from = new Date(dateFrom + 'T00:00:00');
  const to   = new Date(dateTo   + 'T00:00:00');
  const isFullMonth =
    from.getDate() === 1 &&
    to.getDate() === new Date(to.getFullYear(), to.getMonth() + 1, 0).getDate() &&
    from.getMonth() === to.getMonth() &&
    from.getFullYear() === to.getFullYear();
  if (isFullMonth) {
    return from.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  const fLabel = from.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const tLabel = to.toLocaleDateString('en-US',   { month: 'long', year: 'numeric' });
  return fLabel === tLabel ? fLabel : `${fLabel} — ${tLabel}`;
}

export function getCurrentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export const sortList = (list, sort, dateKey = 'date') => {
  const s = [...list];
  switch (sort) {
    case 'date-desc':   return s.sort((a, b) => b[dateKey].localeCompare(a[dateKey]));
    case 'date-asc':    return s.sort((a, b) => a[dateKey].localeCompare(b[dateKey]));
    case 'amount-desc': return s.sort((a, b) => b.amount - a.amount);
    case 'amount-asc':  return s.sort((a, b) => a.amount - b.amount);
    case 'vendor-asc':  return s.sort((a, b) => a.vendor.localeCompare(b.vendor));
    case 'vendor-desc': return s.sort((a, b) => b.vendor.localeCompare(a.vendor));
    default: return s;
  }
};
