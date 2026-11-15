import { monthsFrom, daysInMonth } from '../../utils/dates';
import { categorySpendingByMonth, isSpending } from '../../utils/moneyRules';

// The Overview's spending-by-category small multiples (Phase V, V5b), in cents.

export const PANEL_LIMIT = 8;

// The months a period covers ('YYYY-MM', in order) and those it only partly covers. It runs from
// `startDate` (else the first transaction, else this month) through `endDate` (else this month,
// or a later transaction's). Partial: a first month entered after its 1st, a last month left
// before its last day, and this month, which is still going.
export const periodMonths = (transactions, startDate, endDate, today) => {
  const dates = transactions.map(t => t.date).sort();
  const lastDate = dates.length && dates[dates.length - 1] > today ? dates[dates.length - 1] : today;
  const months = monthsFrom((startDate || dates[0] || today).slice(0, 7), (endDate || lastDate).slice(0, 7));
  const partial = months.filter(month =>
    (startDate && month === startDate.slice(0, 7) && startDate.slice(8) !== '01')
    || (endDate && month === endDate.slice(0, 7) && Number(endDate.slice(8)) < daysInMonth(month))
    || month === today.slice(0, 7));
  return { months, partial };
};

// One panel per category with spending in `months` (plain money out, moneyRules
// categorySpendingByMonth): the top `limit` by total, then the rest added up as Other (which
// names them in `others`). Each: {category, total, count (spending transactions), months:
// [{month, cents, partial}], average (over the full months; null without one), last (the last
// full month's {month, cents}, or null)}.
export const categoryPanels = (transactions, months, partial, limit = PANEL_LIMIT) => {
  const inPeriod = new Set(months);
  const partOnly = new Set(partial);
  const counts = {};
  transactions.forEach(t => { if (isSpending(t)) counts[t.category] = (counts[t.category] || 0) + 1; });

  const ranked = Object.entries(categorySpendingByMonth(transactions.filter(t => inPeriod.has(t.date.slice(0, 7)))))
    .map(([category, byMonth]) => ({ category, byMonth, total: months.reduce((sum, m) => sum + (byMonth[m] || 0), 0) }))
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));
  const rest = ranked.slice(limit);
  const groups = ranked.slice(0, limit).map(c => ({ category: c.category, members: [c] }));
  if (rest.length) groups.push({ category: 'Other', members: rest, others: rest.map(c => c.category).sort() });

  return groups.map(({ category, members, others }) => {
    const panelMonths = months.map(month => ({
      month,
      cents: members.reduce((sum, c) => sum + (c.byMonth[month] || 0), 0),
      partial: partOnly.has(month),
    }));
    const full = panelMonths.filter(m => !m.partial);
    const last = full[full.length - 1];
    return {
      category,
      ...(others && { others }),
      total: members.reduce((sum, c) => sum + c.total, 0),
      count: members.reduce((sum, c) => sum + (counts[c.category] || 0), 0),
      months: panelMonths,
      average: full.length ? Math.round(full.reduce((sum, m) => sum + m.cents, 0) / full.length) : null,
      last: last ? { month: last.month, cents: last.cents } : null,
    };
  });
};
