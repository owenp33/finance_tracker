import { shiftPeriod } from './dates';

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
