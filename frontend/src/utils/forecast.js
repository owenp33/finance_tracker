import { shiftDays } from './dates';
import { isSpending, isReimbursement } from './moneyRules';
import { isFinished } from './recurring';

// The balance forecast (Phase F, F1), in cents. It learns from the last 90 days (today and the 89
// days before it) and reaches as far ahead. A category whose spending over the last 90 days is at
// least 90% in recurring series is forecast by its series' scheduled charges, on their dates;
// every other category, bills included, by its spending over the last 90 days, spread evenly over
// the days ahead. Income is scheduled income only (recurring series): irregular deposits are left
// out. A series with no spending over the last 90 days (a new subscription, or a series of
// transfers) keeps its schedule. A series that has ended won't charge again, so its charges are
// left out of everything the forecast learns. Spending follows utils/moneyRules.js (transfers
// never count), except that a category's reimbursements over the last 90 days come off its
// spending (Owen, 2026-11-15): the paybacks themselves are left out as irregular income, so
// without that a paid-back purchase would count as spending to come.

// How far ahead the forecast reaches, and how many days back it learns from
export const FORECAST_DAYS = 90;

// The share of a category's spending in recurring series that makes it scheduled
const SCHEDULED_PERCENT = 90;

// The first of the last 90 days before `today` (YYYY-MM-DD), today being the last
export const lastNinetyDaysStart = (today) => shiftDays(today, -(FORECAST_DAYS - 1));

// The spending and the reimbursements over the last 90 days in every account, leaving out those
// of the `recurring` templates that have ended
const recentActivity = (transactions, recurring, today) => {
  const from = lastNinetyDaysStart(today);
  const ended = new Set(recurring.filter(isFinished).map(r => r.id));
  const recent = transactions.filter(t => t.date >= from && t.date <= today && !ended.has(t.recurring_id));
  return { spending: recent.filter(isSpending), reimbursements: recent.filter(isReimbursement) };
};

// What's left of a category's spending after its reimbursements (never below 0), and the part of
// it its series cover (they count up to all of it)
const afterReimbursements = ({ total, linked, reimbursed }) => {
  const left = Math.max(total - reimbursed, 0);
  return { left, covered: Math.min(linked, left) };
};

// Each category's spending over the last 90 days across every account (ended series left out):
// `total`, the part in a recurring series (`linked`), its reimbursements (`reimbursed`), and
// whether the series cover at least 90% of what's left after them (`scheduled`; never when
// nothing is left). Positive amounts.
export const categoryShares = (transactions, recurring, today) => {
  const { spending, reimbursements } = recentActivity(transactions, recurring, today);
  const shares = {};
  spending.forEach(t => {
    const share = (shares[t.category] = shares[t.category] || { total: 0, linked: 0, reimbursed: 0 });
    share.total -= t.amount_cents;
    if (t.recurring_id != null) share.linked -= t.amount_cents;
  });
  reimbursements.forEach(t => { if (shares[t.category]) shares[t.category].reimbursed += t.amount_cents; });
  Object.values(shares).forEach(share => {
    const { left, covered } = afterReimbursements(share);
    share.scheduled = left > 0 && covered * 100 >= left * SCHEDULED_PERCENT;
  });
  return shares;
};

// What the forecast of the accounts `accountIds` uses: the projected `occurrences` (GET
// /recurring/projection) it keeps, which are scheduled income, charges in scheduled categories and
// charges of series with no spending over the last 90 days; and `averages`, each other category's
// spending over the last 90 days less its reimbursements, both in those accounts ({category:
// positive cents}; none at 0 or below). `recurring` is every template, to tell which series have
// ended. The 90% test looks at every account, so a category is forecast the same way whichever
// account is shown.
export const forecastInputs = (transactions, recurring, occurrences, accountIds, today) => {
  const shares = categoryShares(transactions, recurring, today);
  const { spending, reimbursements } = recentActivity(transactions, recurring, today);
  const seriesWithSpending = new Set(spending.map(t => t.recurring_id).filter(id => id != null));

  const kept = occurrences.filter(o => accountIds.includes(o.account_id) && (
    o.amount > 0
    || (o.amount < 0 && (shares[o.category]?.scheduled || !seriesWithSpending.has(o.recurring_id)))
  ));

  const averaged = t => accountIds.includes(t.account_id) && shares[t.category] && !shares[t.category].scheduled;
  const left = {};
  [...spending, ...reimbursements]
    .filter(averaged)
    .forEach(t => { left[t.category] = (left[t.category] || 0) - t.amount_cents; });
  const averages = Object.fromEntries(Object.entries(left).filter(([, cents]) => cents > 0));

  return { occurrences: kept, averages };
};

// The forecast from `from` (today) through `to`: the balance stepping from `startCents` by each
// day's scheduled `occurrences` (an item due today included) and by its share of the `averages`,
// a 90th of their total each day after today (rounded on the running total, so 90 days add up to
// exactly the last 90 days' spending). A point for each day that changes, kind 'forecast', with
// that day's `items` and `average` (its share, positive cents); then `to` itself
// ('forecast-end') when it didn't change.
export const forecastPoints = (startCents, { occurrences, averages }, from, to) => {
  const byDay = {};
  occurrences
    .filter(o => o.date >= from && o.date <= to)
    .forEach(o => { (byDay[o.date] = byDay[o.date] || []).push(o); });
  const averageTotal = Object.values(averages).reduce((sum, cents) => sum + cents, 0);

  const points = [];
  let cents = startCents;
  let averaged = 0;           // the average spending counted so far
  for (let day = from, k = 0; day <= to; day = shiftDays(day, 1), k += 1) {
    const items = byDay[day] || [];
    const average = Math.round((averageTotal * k) / FORECAST_DAYS) - averaged;
    averaged += average;
    if (!items.length && average === 0) continue;
    cents += items.reduce((sum, o) => sum + Math.round(o.amount * 100), 0) - average;
    points.push({ date: day, cents, kind: 'forecast', items, average });
  }
  if (!points.length || points[points.length - 1].date < to) {
    points.push({ date: to, cents, kind: 'forecast-end', items: [], average: 0 });
  }
  return points;
};

// What the forecast of the accounts `accountIds` assumes (F1b), for a table. `categories`: one per
// category those accounts spent in over the last 90 days or have a charge due in over the next
// 90, each {category, spent (its spending over the last 90 days in those accounts, ended series
// left out), reimbursed (its reimbursements there), share (the percentage of its spending left
// after reimbursements that its series cover, across every account, rounded down so only a
// scheduled category reads 90 or more; null when none is left), basis ('scheduled', 'average',
// or 'no-history': only charges from series with no spending over the last 90 days), average
// (the spending averaged), scheduled (the charges due, negative), count (how many), forecast
// (what it adds over the next 90 days, negative)}, the largest forecast first, ties by name.
// `income`: the scheduled income due, {cents, count, series (how many pay it)}.
export const forecastAssumptions = (transactions, recurring, occurrences, accountIds, today) => {
  const shares = categoryShares(transactions, recurring, today);
  const { occurrences: kept, averages } = forecastInputs(transactions, recurring, occurrences, accountIds, today);
  const { spending, reimbursements } = recentActivity(transactions, recurring, today);
  const end = shiftDays(today, FORECAST_DAYS);
  const due = kept.filter(o => o.date >= today && o.date <= end);
  const shown = t => accountIds.includes(t.account_id);

  const rows = {};
  const row = (category) => (rows[category] = rows[category] || { category, spent: 0, reimbursed: 0, scheduled: 0, count: 0 });
  spending.filter(shown).forEach(t => { row(t.category).spent -= t.amount_cents; });
  due.filter(o => o.amount < 0).forEach(o => {
    const r = row(o.category);
    r.scheduled += Math.round(o.amount * 100);
    r.count += 1;
  });
  reimbursements.filter(t => shown(t) && rows[t.category]).forEach(t => { rows[t.category].reimbursed += t.amount_cents; });

  const categories = Object.values(rows).map(r => {
    const share = shares[r.category];
    const { left, covered } = share ? afterReimbursements(share) : {};
    const average = averages[r.category] || 0;
    return {
      category: r.category,
      spent: r.spent,
      reimbursed: r.reimbursed,
      share: left > 0 ? Math.floor((covered * 100) / left) : null,
      basis: !share ? 'no-history' : share.scheduled ? 'scheduled' : 'average',
      average,
      scheduled: r.scheduled,
      count: r.count,
      forecast: r.scheduled - average,
    };
  }).sort((a, b) => Math.abs(b.forecast) - Math.abs(a.forecast) || a.category.localeCompare(b.category));

  const paying = due.filter(o => o.amount > 0);
  const income = {
    cents: paying.reduce((sum, o) => sum + Math.round(o.amount * 100), 0),
    count: paying.length,
    series: new Set(paying.map(o => o.recurring_id)).size,
  };
  return { categories, income };
};
