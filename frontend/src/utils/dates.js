// Today as YYYY-MM-DD in the user's time zone (toISOString gives the UTC date, which is
// already tomorrow on a US evening)
export const todayISO = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

// Days in the month 'YYYY-MM'
export const daysInMonth = (period) => {
  const [year, month] = period.split('-').map(Number);
  return new Date(year, month, 0).getDate();
};

// How much of the month 'YYYY-MM' has passed on `today` (YYYY-MM-DD): all of a past month, none of a
// future one, and today's share of the current one's days (today counts as passed)
export const monthElapsed = (period, today) => {
  const thisMonth = today.slice(0, 7);
  if (period !== thisMonth) return period < thisMonth ? 1 : 0;
  return Number(today.slice(8, 10)) / daysInMonth(period);
};
