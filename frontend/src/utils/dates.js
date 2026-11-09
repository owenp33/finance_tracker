// A date as YYYY-MM-DD in the user's time zone (toISOString gives the UTC date, which is
// already tomorrow on a US evening)
const isoDate = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// Today as YYYY-MM-DD in the user's time zone
export const todayISO = () => isoDate(new Date());

// The same day `months` months from `day` (YYYY-MM-DD; negative goes back), or that month's last
// day when it's shorter
export const shiftMonths = (day, months) => {
  const [year, month, date] = day.split('-').map(Number);
  const lastDay = new Date(year, month + months, 0).getDate();
  return isoDate(new Date(year, month - 1 + months, Math.min(date, lastDay)));
};

// The same day of last month as `day` (YYYY-MM-DD), or last month's last day when it's shorter
export const sameDayLastMonth = (day) => shiftMonths(day, -1);

// A run of days within one month, `from` through `to` (YYYY-MM-DD): "Oct 1–5", or "Oct 1"
export const dayRangeLabel = (from, to) => {
  const [year, month, first] = from.split('-').map(Number);
  const last = Number(to.slice(8, 10));
  const name = new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'short' });
  return first === last ? `${name} ${first}` : `${name} ${first}–${last}`;
};

// The month `months` months after 'YYYY-MM' (negative goes back)
export const shiftPeriod = (period, months) => {
  const [year, month] = period.split('-').map(Number);
  const first = new Date(year, month - 1 + months, 1);
  return `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}`;
};

// A run of months 'YYYY-MM' through 'YYYY-MM': "Nov 2025–Oct 2026", "Apr–Oct 2026", or "Sep 2026"
export const monthRangeLabel = (from, to) => {
  const name = (period, withYear) => {
    const [year, month] = period.split('-').map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString('en-US', withYear ? { month: 'short', year: 'numeric' } : { month: 'short' });
  };
  if (from === to) return name(to, true);
  return `${name(from, from.slice(0, 4) !== to.slice(0, 4))}–${name(to, true)}`;
};

// A day 'YYYY-MM-DD' as a whole number of days since Jan 1, 1970, so subtracting two gives the
// days between them (calendar days, whatever the time zone)
export const dayNumber = (day) => {
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date) / 86400000;
};

// Days in the month 'YYYY-MM'
export const daysInMonth = (period) => {
  const [year, month] = period.split('-').map(Number);
  return new Date(year, month, 0).getDate();
};

// The last day of the month 'YYYY-MM', as "Oct 31"
export const monthEndLabel = (period) => {
  const [year, month] = period.split('-').map(Number);
  return new Date(year, month, 0).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// How much of the month 'YYYY-MM' has passed on `today` (YYYY-MM-DD): all of a past month, none of a
// future one, and today's share of the current one's days (today counts as passed)
export const monthElapsed = (period, today) => {
  const thisMonth = today.slice(0, 7);
  if (period !== thisMonth) return period < thisMonth ? 1 : 0;
  return Number(today.slice(8, 10)) / daysInMonth(period);
};
