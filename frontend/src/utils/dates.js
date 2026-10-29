// Today as YYYY-MM-DD in the user's time zone (toISOString gives the UTC date, which is
// already tomorrow on a US evening)
export const todayISO = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};
