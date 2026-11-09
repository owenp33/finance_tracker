import { shiftPeriod, dayNumber } from './dates';
import { formatCents } from './money';

// Recurring series (Phase V, V3), in cents: templates as the API returns them (`amount` in
// dollars, a schedule of every `frequency` days or months, `number` and `idx`) and the user's
// transactions.

// A template's amount in cents: negative for a cost, positive for income
const amountCents = (template) => Math.round(template.amount * 100);

// A limited template is finished once every occurrence is used; it never charges again
export const isFinished = (template) => template.number !== -1 && template.idx > template.number;

// A template's amount per month, signed like it: weekly × 52/12, biweekly × 26/12, monthly × 1,
// quarterly ÷ 3, annually ÷ 12 (every N days repeats 364/N times a year, every N months 12/N)
export const monthlyEquivalent = (template) => {
  const perYear = template.frequency_unit === 'months' ? 12 / template.frequency : 364 / template.frequency;
  const cents = amountCents(template);
  return Math.sign(cents) * Math.round((Math.abs(cents) * perYear) / 12);
};

// A series' payments: the transactions in it, transfers left out
const paymentsOf = (template, transactions) =>
  transactions.filter(t => t.recurring_id === template.id && !t.is_transfer);

// What a cost series paid beyond its schedule, over the 12 full months before `today`'s (from the
// month of its first payment, if later): its payments, as spending, against its cost per month for
// each of those months. Late, split or extra payments all simply count. null until it has a
// payment before this month.
export const paidBeyondSchedule = (template, transactions, today) => {
  const payments = paymentsOf(template, transactions);
  if (payments.length === 0) return null;
  const thisMonth = today.slice(0, 7);
  const yearBack = shiftPeriod(thisMonth, -12);
  const firstMonth = payments.map(t => t.date.slice(0, 7)).sort()[0];
  const from = firstMonth > yearBack ? firstMonth : yearBack;
  const to = shiftPeriod(thisMonth, -1);
  if (from > to) return null;

  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);
  const months = (toYear - fromYear) * 12 + (toMonth - fromMonth) + 1;
  const paid = payments
    .filter(t => t.date.slice(0, 7) >= from && t.date.slice(0, 7) <= to)
    .reduce((sum, t) => sum + Math.max(-t.amount_cents, 0), 0);
  const scheduled = -monthlyEquivalent(template) * months;
  return { from, to, months, paid, scheduled, extra: Math.max(paid - scheduled, 0) };
};

// The month a finished series ended: its last payment's, or its schedule's last occurrence's
const endedMonth = (template, transactions) => {
  const last = paymentsOf(template, transactions).map(t => t.date).sort().pop() ?? template.last_date;
  return last ? last.slice(0, 7) : null;
};

// The period of a series' schedule that `day` falls in, counted from `anchor` (its first payment):
// blocks of N calendar months for a schedule in months (a monthly series' periods are calendar
// months), blocks of N days for one in days
const schedulePeriod = (template, anchor, day) => {
  if (template.frequency_unit === 'months') {
    const [anchorYear, anchorMonth] = anchor.split('-').map(Number);
    const [year, month] = day.split('-').map(Number);
    return Math.floor(((year - anchorYear) * 12 + (month - anchorMonth)) / template.frequency);
  }
  return Math.floor((dayNumber(day) - dayNumber(anchor)) / template.frequency);
};

// A series' payments in date order, each marked `changed` (its amount differs from the payment
// before it) and `extra` (it isn't the first in its schedule period: a calendar month for a monthly
// series, 14 days from the first payment for a biweekly one). These are the plan's timeline
// markers, as Owen chose them (2026-11-07): a late payment counts as extra in the month it lands in.
export const paymentMarks = (template, transactions) => {
  const payments = [...paymentsOf(template, transactions)].sort((a, b) => a.date.localeCompare(b.date));
  const periods = new Set();
  return payments.map((t, i) => {
    const period = schedulePeriod(template, payments[0].date, t.date);
    const extra = periods.has(period);
    periods.add(period);
    return {
      date:         t.date,
      amount_cents: t.amount_cents,
      changed:      i > 0 && t.amount_cents !== payments[i - 1].amount_cents,
      extra,
    };
  });
};

// How one payment of a series compares, for the timeline's hover (`payments`: the series'
// payments; `byMonth`: moneyRules cashFlowByMonth): its size against the series' typical payment
// (the median), how many of the series' payments are larger and smaller, and its month's spending
// (its income, for money in), which includes it
export const paymentComparison = (payment, payments, byMonth) => {
  const size = (p) => Math.abs(p.amount_cents);
  const amount = size(payment);
  const sizes = payments.map(size).sort((a, b) => a - b);
  const middle = Math.floor(sizes.length / 2);
  const income = payment.amount_cents > 0;
  const month = payment.date.slice(0, 7);
  return {
    amount,
    typical:    sizes.length % 2 ? sizes[middle] : Math.round((sizes[middle - 1] + sizes[middle]) / 2),
    count:      sizes.length,
    larger:     sizes.filter(s => s > amount).length,
    smaller:    sizes.filter(s => s < amount).length,
    month,
    income,
    monthTotal: byMonth[month]?.[income ? 'income' : 'expenses'] ?? 0,
  };
};

// 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st
const ordinal = (n) => {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

// paymentComparison in words: against the series' typical payment ("2.3× its typical payment of
// $45.00"), its rank in the series counted from the nearer end ("Tied for its 2nd smallest of 5
// payments"), and its share of the month ("7% of your April 2026 spending ($1,483.73)", "so far"
// in `today`'s month). Owen chose these three (2026-11-08).
export const paymentComparisonLines = (c, today) => {
  const ratio = c.typical > 0 ? Math.round((c.amount / c.typical) * 10) / 10 : null;
  const typical = ratio === null ? null : ratio === 1
    ? `Same as its typical payment of ${formatCents(c.typical)}`
    : `${ratio.toFixed(1)}× its typical payment of ${formatCents(c.typical)}`;

  let rank;
  if (c.count === 1) rank = 'Its only payment';
  else if (c.larger === 0 && c.smaller === 0) rank = `All ${c.count} of its payments are this amount`;
  else {
    const place = c.larger === 0 ? 'largest'
      : c.smaller === 0 ? 'smallest'
        : c.larger <= c.smaller ? `${ordinal(c.larger + 1)} largest` : `${ordinal(c.smaller + 1)} smallest`;
    const tied = c.count - c.larger - c.smaller - 1 > 0;
    rank = `${tied ? 'Tied for its' : 'Its'} ${place} of ${c.count} payments`;
  }

  let share = null;
  if (c.monthTotal > 0) {
    const [year, month] = c.month.split('-').map(Number);
    const monthName = new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const percent = Math.round((c.amount / c.monthTotal) * 100);
    const soFar = c.month === today.slice(0, 7) ? ' so far' : '';
    share = `${percent < 1 ? 'Under 1%' : `${percent}%`} of your ${monthName} ${c.income ? 'income' : 'spending'}${soFar} `
      + `(${formatCents(c.monthTotal)})`;
  }
  return [typical, rank, share].filter(Boolean);
};

// Where a timeline row starts: its first payment, else its first scheduled day; one with nothing to
// draw sorts last
const rowStart = (row) => row.posted?.from ?? row.scheduled?.from ?? '9999-12-31';

// Each series' life for the timeline, income series included: its payments (paymentMarks), drawn
// from the first to the last (`posted`), and while it's active what's still scheduled
// (`scheduled`): from today (or, before its first payment, its next date) to its last occurrence
// in `occurrences` (GET /recurring/projection through `windowEnd`), or to `windowEnd` when it runs
// on past it (`continues`). An ended one has the month it ended. Earliest start first.
export const seriesTimeline = (templates, transactions, occurrences, today, windowEnd) => templates
  .map(template => {
    const payments = paymentMarks(template, transactions);
    const active = !isFinished(template);
    const upcoming = occurrences.filter(o => o.recurring_id === template.id).map(o => o.date).sort();
    const continues = active && (template.number === -1 || template.number - template.idx + 1 > upcoming.length);
    const from = payments.length > 0 || template.next_date < today ? today : template.next_date;
    const to = continues ? windowEnd : upcoming[upcoming.length - 1];
    return {
      template,
      kind:      template.amount > 0 ? 'income' : 'cost',
      active,
      payments,
      posted:    payments.length > 0 ? { from: payments[0].date, to: payments[payments.length - 1].date } : null,
      scheduled: active && to && from <= to ? { from, to } : null,
      continues,
      ended:     active ? null : endedMonth(template, transactions),
    };
  })
  .sort((a, b) => rowStart(a).localeCompare(rowStart(b)) || a.template.vendor.localeCompare(b.template.vendor));

// The user's recurring costs (income series aren't costs): each series with its cost per month
// (`monthly`, positive); an active one with what it paid beyond its schedule (`beyond`), an ended
// one with the month it ended (`ended`). Active first, then ended, each costliest first. `total`
// is the active series' cost per month.
export const recurringCosts = (templates, transactions, today) => {
  const series = templates
    .filter(template => template.amount < 0)
    .map(template => {
      const active = !isFinished(template);
      return {
        template,
        active,
        monthly: -monthlyEquivalent(template),
        ended:   active ? null : endedMonth(template, transactions),
        beyond:  active ? paidBeyondSchedule(template, transactions, today) : null,
      };
    })
    .sort((a, b) => (b.active - a.active) || (b.monthly - a.monthly));
  const active = series.filter(s => s.active);
  return {
    series,
    total:       active.reduce((sum, s) => sum + s.monthly, 0),
    activeCount: active.length,
    incomeCount: templates.filter(template => template.amount > 0).length,
  };
};
