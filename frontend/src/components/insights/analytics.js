// Pure analytics helpers shared by the Overview and Reports tabs.

// Derives the same analytics shape the backend produces, from a raw transactions array.
export function computeAnalytics(transactions) {
  if (!transactions || transactions.length === 0) return null;

  const nonTransfers = transactions.filter(t => !t.is_transfer);
  const expenses = nonTransfers.filter(t => t.amount < 0);
  const income   = nonTransfers.filter(t => t.amount >= 0);

  const totalIncome   = income.reduce((s, t) => s + t.amount, 0);
  const totalExpenses = expenses.reduce((s, t) => s + Math.abs(t.amount), 0);
  const avgTransaction = nonTransfers.length > 0
    ? nonTransfers.reduce((s, t) => s + Math.abs(t.amount), 0) / nonTransfers.length
    : 0;

  const groupBy = (txns, key, getValue) => {
    const map = {};
    for (const t of txns) {
      const k = t[key];
      if (!map[k]) map[k] = [];
      map[k].push(getValue(t));
    }
    return map;
  };

  const toCatRows = (map, total) =>
    Object.entries(map)
      .map(([category, vals]) => {
        const sum = vals.reduce((s, v) => s + v, 0);
        return {
          category,
          total: sum,
          average: sum / vals.length,
          count: vals.length,
          percentage: total > 0 ? ((sum / total) * 100).toFixed(1) : '0.0',
        };
      })
      .sort((a, b) => b.total - a.total);

  const spending_by_category = toCatRows(
    groupBy(expenses, 'category', t => Math.abs(t.amount)),
    totalExpenses,
  );
  const income_by_category = toCatRows(
    groupBy(income, 'category', t => t.amount),
    totalIncome,
  );

  // Monthly summary — sorted newest-first to match backend convention
  // (Overview/Reports reverse it for the line chart so oldest renders on the left)
  const monthMap = {};
  for (const t of nonTransfers) {
    const m = t.date.substring(0, 7);
    if (!monthMap[m]) monthMap[m] = { income: 0, expenses: 0 };
    if (t.amount >= 0) monthMap[m].income   += t.amount;
    else               monthMap[m].expenses += Math.abs(t.amount);
  }
  const monthly_summary = Object.entries(monthMap)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, { income: inc, expenses: exp }]) => ({
      month, income: inc, expenses: exp, net: inc - exp,
    }));

  // Top vendors by absolute spend
  const vendorMap = groupBy(expenses, 'vendor', t => Math.abs(t.amount));
  const top_vendors = Object.entries(vendorMap)
    .map(([vendor, vals]) => ({ vendor, amount: vals.reduce((s, v) => s + v, 0) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  // Weekly averages over the span of the non-transfer transactions
  const dates  = nonTransfers.map(t => new Date(t.date));
  const minMs  = Math.min(...dates);
  const maxMs  = Math.max(...dates);
  const weeks  = Math.max(1, (maxMs - minMs) / (7 * 24 * 60 * 60 * 1000));

  return {
    summary: {
      transaction_count: nonTransfers.length,
      total_income:      totalIncome,
      total_expenses:    totalExpenses,
      net_amount:        totalIncome - totalExpenses,
      avg_transaction:   avgTransaction,
    },
    spending_by_category,
    income_by_category,
    monthly_summary,
    top_vendors,
    trends: {
      weekly_avg_income:    totalIncome   / weeks,
      weekly_avg_expenses:  totalExpenses / weeks,
    },
  };
}

export const PRESETS = [
  ['all', 'All Time'],
  ['1m',  '1M'],
  ['3m',  '3M'],
  ['6m',  '6M'],
  ['1y',  '1Y'],
  ['ytd', 'YTD'],
];

export const toISO = d => d.toISOString().slice(0, 10);

export function presetDates(preset) {
  const today = new Date();
  if (preset === 'all')  return { start: '', end: '' };
  if (preset === 'ytd')  return { start: `${today.getFullYear()}-01-01`, end: toISO(today) };
  const months = { '1m': 1, '3m': 3, '6m': 6, '1y': 12 }[preset];
  const d = new Date(today);
  d.setMonth(d.getMonth() - months);
  return { start: toISO(d), end: toISO(today) };
}
