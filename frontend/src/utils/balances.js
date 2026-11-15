import { shiftMonths } from './dates';

// Balances over time (Phase V, V4), in cents, from GET /api/balances entries: `opening_cents` (the
// starting balance), `days` (each date with transactions and its end-of-day `balance_cents`) and
// `closing_cents` (the current balance).

// The ranges the balance chart offers, and how many months back each reaches (All: the first day)
export const RANGES = ['3M', '6M', '1Y', 'All'];
const MONTHS_BACK = { '3M': 3, '6M': 6, '1Y': 12 };

// The balance at the end of `day`: the last end-of-day balance on or before it, or the opening
export const balanceAsOf = (series, day) => {
  let cents = series.opening_cents;
  for (const d of series.days) {
    if (d.date > day) break;
    cents = d.balance_cents;
  }
  return cents;
};

// Every account added up, in the same shape: on each date any of them changed, the sum of all
// their balances at the end of that day (each carried forward from its own last change)
export const netPosition = (entries) => {
  const dates = [...new Set(entries.flatMap(e => e.days.map(d => d.date)))].sort();
  const opening = entries.reduce((sum, e) => sum + e.opening_cents, 0);
  const last = entries.map(() => -1);       // each entry's latest day on or before the date
  const days = dates.map(date => {
    let total = 0;
    entries.forEach((e, i) => {
      while (last[i] + 1 < e.days.length && e.days[last[i] + 1].date <= date) last[i] += 1;
      total += last[i] >= 0 ? e.days[last[i]].balance_cents : e.opening_cents;
    });
    return { date, balance_cents: total };
  });
  return { opening_cents: opening, days, closing_cents: days.length ? days[days.length - 1].balance_cents : opening };
};

// Where `range` starts: 3, 6 or 12 months before `today` (clamped to a shorter month), or
// `firstDay` for All
export const rangeStart = (range, today, firstDay) =>
  (range in MONTHS_BACK ? shiftMonths(today, -MONTHS_BACK[range]) : firstDay);

// The forecast from `from` (today) through `to` (Phase V, V6b): the balance stepping from
// `startCents` by each day's scheduled `occurrences` (GET /recurring/projection, already only the
// shown accounts'), kind 'forecast' with that day's `items`, then `to` itself ('forecast-end')
// when nothing is scheduled on it. Known recurring items only: everyday spending isn't in it.
export const forecastPoints = (startCents, occurrences, from, to) => {
  const byDay = {};
  occurrences
    .filter(o => o.date >= from && o.date <= to)
    .forEach(o => { (byDay[o.date] = byDay[o.date] || []).push(o); });
  let cents = startCents;
  const points = Object.keys(byDay).sort().map(date => {
    cents += byDay[date].reduce((sum, o) => sum + Math.round(o.amount * 100), 0);
    return { date, cents, kind: 'forecast', items: byDay[date] };
  });
  if (!points.length || points[points.length - 1].date < to) points.push({ date: to, cents, kind: 'forecast-end', items: [] });
  return points;
};

// A range's points for a step line: the balance carried into `from` (kind 'start'), each date's
// end-of-day balance from `from` through `to` ('day'), and `to` itself when nothing changed on it
// ('end'), so the line spans the whole range
export const rangePoints = (series, from, to) => {
  const before = series.days.filter(d => d.date < from);
  const carried = before.length ? before[before.length - 1].balance_cents : series.opening_cents;
  const points = [
    { date: from, cents: carried, kind: 'start' },
    ...series.days
      .filter(d => d.date >= from && d.date <= to)
      .map(d => ({ date: d.date, cents: d.balance_cents, kind: 'day' })),
  ];
  const last = points[points.length - 1];
  if (last.date < to) points.push({ date: to, cents: last.cents, kind: 'end' });
  return points;
};
