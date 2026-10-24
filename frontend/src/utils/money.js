// Dollar amounts for display: "$1,234.50", "-$815.07"
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export const formatDollars = (amount) => usd.format(amount ?? 0);
