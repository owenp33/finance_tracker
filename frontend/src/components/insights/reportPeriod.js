// Pure calendar-period date-math for the Reports tab's Monthly/Quarterly/Annual
// period selector. Kept separate from analytics.js (PRESETS/presetDates), which
// is shared by Overview and AllTransactions and must not change behavior.
//
// Unlike analytics.js's toISO (which round-trips through toISOString() / UTC),
// every date here is formatted from local Date getters to avoid shifting dates
// near midnight in negative-UTC-offset timezones.

export const PERIOD_MODES = ['all', 'monthly', 'quarterly', 'annual', 'custom'];

const pad = n => String(n).padStart(2, '0');

export const toLocalISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const daysInMonth = (year, monthIndex) => new Date(year, monthIndex + 1, 0).getDate();

const quarterStartMonth = quarterIndex => quarterIndex * 3;

// `period` shape: { mode, year, index }
// - monthly:   index = month index (0-11)
// - quarterly: index = quarter index (0-3)
// - annual:    index = null

export function periodContainingToday(mode) {
  const today = new Date();
  if (mode === 'monthly')   return { mode, year: today.getFullYear(), index: today.getMonth() };
  if (mode === 'quarterly') return { mode, year: today.getFullYear(), index: Math.floor(today.getMonth() / 3) };
  if (mode === 'annual')    return { mode, year: today.getFullYear(), index: null };
  return null;
}

export function stepPeriod(period, delta) {
  if (!period) return period;
  const { mode, year, index } = period;

  if (mode === 'monthly') {
    const total = year * 12 + index + delta;
    return { mode, year: Math.floor(total / 12), index: ((total % 12) + 12) % 12 };
  }
  if (mode === 'quarterly') {
    const total = year * 4 + index + delta;
    return { mode, year: Math.floor(total / 4), index: ((total % 4) + 4) % 4 };
  }
  if (mode === 'annual') {
    return { mode, year: year + delta, index: null };
  }
  return period;
}

// Returns { start: Date, end: Date } — end is the last day of the period (inclusive).
export function periodBounds(period) {
  const { mode, year, index } = period;

  if (mode === 'monthly') {
    return {
      start: new Date(year, index, 1),
      end: new Date(year, index, daysInMonth(year, index)),
    };
  }
  if (mode === 'quarterly') {
    const startMonth = quarterStartMonth(index);
    const endMonth = startMonth + 2;
    return {
      start: new Date(year, startMonth, 1),
      end: new Date(year, endMonth, daysInMonth(year, endMonth)),
    };
  }
  // annual
  return {
    start: new Date(year, 0, 1),
    end: new Date(year, 11, 31),
  };
}

// Caps `end` at `today` only when the period straddles today (start <= today <= calendarEnd).
// Past periods and navigated-to future periods are returned unchanged.
export function capEndDate(start, end, today) {
  if (start <= today && today <= end) return today;
  return end;
}

// Resolves a mode/period pair into the { start, end } ISO date strings consumed by
// the existing startDate/endDate filter state (and ultimately the backend query params).
export function resolvePeriodRange(mode, period, today = new Date()) {
  if (mode === 'all' || mode === 'custom' || !period) {
    return { start: '', end: '' };
  }
  const { start, end } = periodBounds(period);
  const cappedEnd = capEndDate(start, end, today);
  return { start: toLocalISO(start), end: toLocalISO(cappedEnd) };
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function formatPeriodLabel(mode, period) {
  if (!period) return '';
  const { year, index } = period;
  if (mode === 'monthly')   return `${MONTH_NAMES[index]} ${year}`;
  if (mode === 'quarterly') return `Q${index + 1} ${year}`;
  if (mode === 'annual')    return `${year}`;
  return '';
}
