import { isIncome, isSpending } from '../../utils/moneyRules';
import { todayISO, shiftMonths, dayNumber } from '../../utils/dates';

// Pure analytics helpers for the Overview tab, by the shared money rules (utils/moneyRules.js,
// decision 2): transfers never count, income is money in (reimbursements included), spending is
// money out, and a zero amount is neither. Sums are in cents; the results are in dollars, in the
// shape the backend's AnalyticsService produces, less its monthly summary and top vendors (the
// Overview's come from monthlyNet since V5c and topVendors since V5d).

const dollars = (cents) => cents / 100;
const size = (t) => Math.abs(t.amount_cents);
const total = (list) => list.reduce((sum, t) => sum + size(t), 0);

// Rows of {[key], total, average, count, percentage (of `whole`, a string)}, largest first
const byKey = (list, key, whole) => {
  const groups = {};
  for (const t of list) (groups[t[key]] = groups[t[key]] || []).push(t);
  return Object.entries(groups)
    .map(([name, group]) => {
      const cents = total(group);
      return {
        [key]: name,
        total: dollars(cents),
        average: dollars(cents / group.length),
        count: group.length,
        percentage: whole > 0 ? ((cents / whole) * 100).toFixed(1) : '0.0',
      };
    })
    .sort((a, b) => b.total - a.total);
};

// The Overview's numbers from a list of transactions (null when there are none)
export function computeAnalytics(transactions) {
  if (!transactions || transactions.length === 0) return null;

  const income = transactions.filter(isIncome);
  const expenses = transactions.filter(isSpending);
  const counted = [...income, ...expenses];
  const incomeCents = total(income);
  const expenseCents = total(expenses);

  // Weekly averages over the days from the first counted transaction to the last (at least a week)
  const days = counted.map(t => dayNumber(t.date));
  const weeks = days.length ? Math.max(1, (Math.max(...days) - Math.min(...days)) / 7) : 1;

  return {
    summary: {
      transaction_count: counted.length,
      total_income:      dollars(incomeCents),
      total_expenses:    dollars(expenseCents),
      net_amount:        dollars(incomeCents - expenseCents),
      avg_transaction:   counted.length ? dollars(total(counted) / counted.length) : 0,
    },
    spending_by_category: byKey(expenses, 'category', expenseCents),
    income_by_category:   byKey(income, 'category', incomeCents),
    trends: {
      weekly_avg_income:   dollars(incomeCents) / weeks,
      weekly_avg_expenses: dollars(expenseCents) / weeks,
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

// A preset's dates through today, by the local date: the same day 1, 3, 6 or 12 months back
// (a shorter month's last day when needed), Jan 1 for YTD, none for All Time
export function presetDates(preset) {
  const today = todayISO();
  if (preset === 'all')  return { start: '', end: '' };
  if (preset === 'ytd')  return { start: `${today.slice(0, 4)}-01-01`, end: today };
  const months = { '1m': 1, '3m': 3, '6m': 6, '1y': 12 }[preset];
  return { start: shiftMonths(today, -months), end: today };
}
