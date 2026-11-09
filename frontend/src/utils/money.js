// Dollar amounts for display: "$1,234.50", "-$815.07"
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export const formatDollars = (amount) => usd.format(amount ?? 0);

// Estimates, rounded to whole dollars: "$1,235"
const usdWhole = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0,
});

export const formatWholeDollars = (amount) => usdWhole.format(amount ?? 0);

// Amounts kept in cents (the API's *_cents fields), as formatDollars shows them
export const formatCents = (cents) => formatDollars(cents / 100);

// Dollars for a chart axis: whole dollars under $1,000 ("$350", "-$991"), then thousands ("$7.3k", "$14k")
export const formatCompactDollars = (dollars) => {
  const abs = Math.abs(dollars);
  const text = abs >= 1000 ? `$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k` : `$${Math.round(abs)}`;
  return dollars < 0 ? `-${text}` : text;
};

// A change in cents, signed: "+$5,985.41", "-$500.00", "$0.00"
export const formatSignedCents = (cents) => (cents > 0 ? `+${formatCents(cents)}` : formatCents(cents));
