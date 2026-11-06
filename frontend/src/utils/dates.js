// A date as YYYY-MM-DD in the user's time zone (toISOString gives the UTC date, which is
// already tomorrow on a US evening)
const isoDate = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// Today as YYYY-MM-DD in the user's time zone
export const todayISO = () => isoDate(new Date());

// The same day of last month as `day` (YYYY-MM-DD), or last month's last day when it's shorter
export const sameDayLastMonth = (day) => {
  const [year, month, date] = day.split('-').map(Number);
  const lastMonthDays = new Date(year, month - 1, 0).getDate();
  return isoDate(new Date(year, month - 2, Math.min(date, lastMonthDays)));
};

// A run of days within one month, `from` through `to` (YYYY-MM-DD): "Oct 1–5", or "Oct 1"
export const dayRangeLabel = (from, to) => {
  const [year, month, first] = from.split('-').map(Number);
  const last = Number(to.slice(8, 10));
  const name = new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'short' });
  return first === last ? `${name} ${first}` : `${name} ${first}–${last}`;
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
