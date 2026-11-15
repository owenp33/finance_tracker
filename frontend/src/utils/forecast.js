import { shiftDays } from './dates';
import { isSpending } from './moneyRules';

// The balance forecast (Phase F, F1), in cents. It learns from the last 90 days (today and the 89
// days before it) and reaches as far ahead. A category whose spending over the last 90 days is at
// least 90% in recurring series is forecast by its series' scheduled charges, on their dates;
// every other category, bills included, by its spending over the last 90 days, spread evenly over
// the days ahead. Income is scheduled income only (recurring series): irregular deposits are left
// out. A series with no spending over the last 90 days (a new subscription, or a series of
// transfers) keeps its schedule. Spending is plain spending (utils/moneyRules.js): transfers never
// count, and reimbursements aren't taken off.

// How far ahead the forecast reaches, and how many days back it learns from
export const FORECAST_DAYS = 90;

// The share of a category's spending in recurring series that makes it scheduled
const SCHEDULED_PERCENT = 90;

// The first of the last 90 days before `today` (YYYY-MM-DD), today being the last
export const lastNinetyDaysStart = (today) => shiftDays(today, -(FORECAST_DAYS - 1));

// Spending over the last 90 days, in every account
const recentSpending = (transactions, today) => {
  const from = lastNinetyDaysStart(today);
  return transactions.filter(t => isSpending(t) && t.date >= from && t.date <= today);
};

// Each category's spending over the last 90 days across every account: `total`, the part in a
// recurring series (`linked`), and whether that's at least 90% (`scheduled`). Positive amounts.
export const categoryShares = (transactions, today) => {
  const shares = {};
  recentSpending(transactions, today).forEach(t => {
    const share = (shares[t.category] = shares[t.category] || { total: 0, linked: 0 });
    share.total -= t.amount_cents;
    if (t.recurring_id != null) share.linked -= t.amount_cents;
  });
  Object.values(shares).forEach(share => {
    share.scheduled = share.linked * 100 >= share.total * SCHEDULED_PERCENT;
  });
  return shares;
};

// What the forecast of the accounts `accountIds` uses: the projected `occurrences` (GET
// /recurring/projection) it keeps, which are scheduled income, charges in scheduled categories and
// charges of series with no spending over the last 90 days; and `averages`, each other category's
// spending over the last 90 days in those accounts ({category: positive cents}). The 90% test
// looks at every account, so a category is forecast the same way whichever account is shown.
export const forecastInputs = (transactions, occurrences, accountIds, today) => {
  const shares = categoryShares(transactions, today);
  const recent = recentSpending(transactions, today);
  const seriesWithSpending = new Set(recent.map(t => t.recurring_id).filter(id => id != null));

  const kept = occurrences.filter(o => accountIds.includes(o.account_id) && (
    o.amount > 0
    || (o.amount < 0 && (shares[o.category]?.scheduled || !seriesWithSpending.has(o.recurring_id)))
  ));

  const averages = {};
  recent
    .filter(t => accountIds.includes(t.account_id) && !shares[t.category].scheduled)
    .forEach(t => { averages[t.category] = (averages[t.category] || 0) - t.amount_cents; });

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
