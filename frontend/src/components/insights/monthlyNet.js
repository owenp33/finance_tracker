import { cashFlowByMonth } from '../../utils/moneyRules';

// The Overview's net per month (Phase V, V5c), in cents: for each of `months` (categoryPanels
// periodMonths), its money in, money out and net by the shared rules (moneyRules cashFlowByMonth;
// a month without transactions at 0), whether the period only partly covers it, and the 3-month
// average of net (`average`) on the middle month: each month's with the months either side, when
// all three are full (else null), so the first and last month have none and partial months are in
// no average.
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
  rows.forEach((row, i) => {
    const three = rows.slice(i - 1, i + 2);
    if (i >= 1 && three.length === 3 && three.every(month => !month.partial)) {
      row.average = Math.round((three[0].net + three[1].net + three[2].net) / 3);
    }
  });
  return rows;
};
