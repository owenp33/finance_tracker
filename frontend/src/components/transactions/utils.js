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

export const subtractDays = (dateStr, days) => {
  const dt = dateStrToDate(dateStr);
  dt.setDate(dt.getDate() - days);
  return dt;
};

export const frequencyLabel = (days) => {
  const map = { 7: 'Weekly', 14: 'Biweekly', 30: 'Monthly', 60: 'Every 2 months', 90: 'Quarterly', 365: 'Yearly' };
  return map[days] || `Every ${days} days`;
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
