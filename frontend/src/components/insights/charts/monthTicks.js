// Month labels for the Overview's monthly charts (category panels, net per month)

const ALL_TICKS_UP_TO = 8;    // months; a longer run labels only its first month, Januaries and Julys

// "Oct", or with the year for a January or the first tick: "Jan 2026"
export const monthTick = (month, index) => {
  const [year, m] = month.split('-').map(Number);
  const withYear = m === 1 || index === 0;
  return new Date(year, m - 1, 1).toLocaleDateString('en-US', withYear ? { month: 'short', year: 'numeric' } : { month: 'short' });
};

// The months to label: all of a short run; of a long one, the first, Januaries and Julys
export const tickMonths = (months) => (months.length <= ALL_TICKS_UP_TO ? months
  : months.filter((month, i) => i === 0 || month.endsWith('-01') || month.endsWith('-07')));
