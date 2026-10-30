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
