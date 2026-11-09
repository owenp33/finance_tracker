import { cashFlowByMonth } from '../../utils/moneyRules';

// The Overview's net per month (Phase V, V5c), in cents: for each of `months` (categoryPanels
// periodMonths), its money in, money out and net by the shared rules (moneyRules cashFlowByMonth;
// a month without transactions at 0), whether the period only partly covers it, and the 3-month
// moving average of net (`average`): each full month with the two full months before it, so it
// starts at the third full month and partial months are in no average.
export const monthlyNet = (transactions, months, partial) => {
  const byMonth = cashFlowByMonth(transactions);
  const partOnly = new Set(partial);
  const rows = months.map(month => ({
    month,
    income:   byMonth[month]?.income ?? 0,
    expenses: byMonth[month]?.expenses ?? 0,
    net:      byMonth[month]?.net ?? 0,
    partial:  partOnly.has(month),
    average:  null,
  }));
  const full = rows.filter(row => !row.partial);
  full.forEach((row, i) => {
    if (i >= 2) row.average = Math.round((full[i].net + full[i - 1].net + full[i - 2].net) / 3);
  });
  return rows;
};
