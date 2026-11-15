import { formatDollars, formatWholeDollars } from './money';
import { monthElapsed } from './dates';

// Budget pace (Phase V, V1): how a budgeted category's spending so far compares with what it was
// expected to have spent by now. Works on rows of GET /api/budgets/progress, in cents.

// Spending within this share of the budget (and at least ON_PACE_MIN_CENTS) of the expected
// spend is "On pace"
export const ON_PACE_SHARE = 0.02;
export const ON_PACE_MIN_CENTS = 100;

// What the category may spend in its month: the allocation plus what rolled over
const effectiveCents = (row) => row.allocated_cents + row.carried_over_cents;

// An even pace, `elapsed` (0–1, dates.js monthElapsed) of the way through the month: the same share
// of the budget spent by now, and the month's end at the current rate (none before it starts)
export const evenExpectation = (row, elapsed) => ({
  expected:  Math.round(effectiveCents(row) * elapsed),
  projected: elapsed > 0 ? Math.round(row.spent_cents / elapsed) : null,
  basis:     'even',
});

// Spending in cents: an outflow as a positive amount; money in counts as none
const spendingCents = (amountCents) => Math.max(-amountCents, 0);

// The projection's occurrences in the row's category and the month `period`, and their spending
const occurrencesIn = (row, occurrences, period) =>
  occurrences.filter(o => o.category === row.category && o.date.startsWith(period));
const occurrenceSpending = (list) => list.reduce((sum, o) => sum + spendingCents(Math.round(o.amount * 100)), 0);

// The category's bills still due in `period`: its occurrences in the projection, which lists only
// ones not charged yet (GET /api/recurring/projection)
export const billsDue = (row, occurrences, period) => occurrenceSpending(occurrencesIn(row, occurrences, period));

// A scheduled pace on `today` in the current month `period`: the category's recurring charges so
// far (the month's charges in a series, from the user's `transactions`, transfers left out, plus
// the projection's `occurrences` due by today), and the month's end at what's spent plus the
// occurrences still to come (GET /api/recurring/projection only lists ones not charged yet)
export const scheduledExpectation = (row, { transactions, occurrences, period, today }) => {
  const posted = transactions
    .filter(t => t.recurring_id != null && !t.is_transfer && t.category === row.category && t.date.startsWith(period))
    .reduce((sum, t) => sum + spendingCents(t.amount_cents), 0);
  const upcoming = occurrencesIn(row, occurrences, period);
  return {
    expected:  posted + occurrenceSpending(upcoming.filter(o => o.date <= today)),
    projected: row.spent_cents + occurrenceSpending(upcoming),
    basis:     'scheduled',
  };
};

// Over budget (by how much), or how far the spending is ahead of or under the expected spend
export const paceStatus = (spent, expected, effective) => {
  if (spent > effective) return { status: 'over', gap: spent - effective };
  const gap = spent - expected;
  if (Math.abs(gap) < Math.max(effective * ON_PACE_SHARE, ON_PACE_MIN_CENTS)) return { status: 'on-pace', gap: 0 };
  return gap > 0 ? { status: 'ahead', gap } : { status: 'under', gap: -gap };
};

// A budget row's pace, given what was expected of it ({expected, projected, basis}:
// evenExpectation or scheduledExpectation) and its bills still due (billsDue), with how far past
// the budget those bills would take it (none once it's already over)
export const budgetPace = (row, { expected, projected, basis }, due = 0) => {
  const effective = effectiveCents(row);
  const spent = row.spent_cents;
  const status = paceStatus(spent, expected, effective);
  return {
    effective,
    spent,
    carriedOver:  row.carried_over_cents,
    expected,
    projected,
    basis,
    ...status,
    due,
    overAfterDue: status.status === 'over' ? 0 : Math.max(spent + due - effective, 0),
  };
};

// A budget row's pace in `period` on `today`, the same in every view: this month, its recurring
// charges so far when it's paced by recurring (else an even share), with its bills still due; a
// past month expects its whole budget and a future one nothing yet. `transactions` are the user's,
// `occurrences` this month's projection (hooks/useProjection.js useMonthProjection).
export const rowPace = (row, { period, today, transactions, occurrences }) => {
  const current = period === today.slice(0, 7);
  const expectation = current && row.scheduled_pace
    ? scheduledExpectation(row, { transactions, occurrences, period, today })
    : evenExpectation(row, monthElapsed(period, today));
  return budgetPace(row, expectation, current ? billsDue(row, occurrences, period) : 0);
};

// Sorts paces furthest ahead of pace first: over budget (the most over first), then by how far the
// spending is past what was expected by now
export const furthestAheadFirst = (a, b) => {
  const aOver = a.status === 'over';
  const bOver = b.status === 'over';
  if (aOver !== bOver) return aOver ? -1 : 1;
  return aOver ? b.gap - a.gap : (b.spent - b.expected) - (a.spent - a.expected);
};

// The share of the budget spent, as a whole percent (null without a budget)
export const percentUsed = ({ spent, effective }) => (effective > 0 ? Math.round((spent / effective) * 100) : null);

// "Over by $19.40" (exact), "$15 ahead" and "$43 under" (estimates, in whole dollars), "On pace"
export const paceLabel = ({ status, gap }) => {
  switch (status) {
    case 'over':  return `Over by ${formatDollars(gap / 100)}`;
    case 'ahead': return `${formatWholeDollars(gap / 100)} ahead`;
    case 'under': return `${formatWholeDollars(gap / 100)} under`;
    default:      return 'On pace';
  }
};
