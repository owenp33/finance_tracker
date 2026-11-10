import { isSpending } from '../../utils/moneyRules';

// The Overview's top vendors (Phase V, V5d), in cents. (Not topVendors.js: it would be the same
// file as the TopVendors.js component on a case-insensitive file system.)

export const VENDOR_LIMIT = 10;

// Spending by the shared rules (no transfers, no money in), less charges in a recurring series
// when `leaveOutRecurring` (so the loan and rent don't dominate)
const charges = (transactions, leaveOutRecurring) =>
  transactions.filter(t => isSpending(t) && !(leaveOutRecurring && t.recurring_id != null));

// The vendors spent with most: {vendor, total, count, average (per charge)}, largest first, ties by
// name, the top `limit`
export const topVendors = (transactions, { leaveOutRecurring = false, limit = VENDOR_LIMIT } = {}) => {
  const vendors = {};
  charges(transactions, leaveOutRecurring).forEach(t => {
    const v = (vendors[t.vendor] = vendors[t.vendor] || { vendor: t.vendor, total: 0, count: 0 });
    v.total -= t.amount_cents;
    v.count += 1;
  });
  return Object.values(vendors)
    .map(v => ({ ...v, average: Math.round(v.total / v.count) }))
    .sort((a, b) => b.total - a.total || a.vendor.localeCompare(b.vendor))
    .slice(0, limit);
};

// One vendor's spending: its charges newest first, their total, count and average, and its
// spending in each of `months` (`partial` ones marked) with the average over the full months
// (`monthlyAverage`, null without one), for the same small chart the category panels use
export const vendorDetail = (transactions, vendor, months, partial, { leaveOutRecurring = false } = {}) => {
  const own = charges(transactions, leaveOutRecurring)
    .filter(t => t.vendor === vendor)
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = own.reduce((sum, t) => sum - t.amount_cents, 0);
  const byMonth = {};
  own.forEach(t => { byMonth[t.date.slice(0, 7)] = (byMonth[t.date.slice(0, 7)] || 0) - t.amount_cents; });
  const partOnly = new Set(partial);
  const perMonth = months.map(month => ({ month, cents: byMonth[month] || 0, partial: partOnly.has(month) }));
  const full = perMonth.filter(m => !m.partial);
  return {
    transactions: own,
    total,
    count: own.length,
    average: own.length ? Math.round(total / own.length) : 0,
    months: perMonth,
    monthlyAverage: full.length ? Math.round(full.reduce((sum, m) => sum + m.cents, 0) / full.length) : null,
  };
};
