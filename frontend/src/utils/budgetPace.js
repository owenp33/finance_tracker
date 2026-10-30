import { formatDollars, formatWholeDollars } from './money';

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
});

// Over budget (by how much), or how far the spending is ahead of or under the expected spend
export const paceStatus = (spent, expected, effective) => {
  if (spent > effective) return { status: 'over', gap: spent - effective };
  const gap = spent - expected;
  if (Math.abs(gap) < Math.max(effective * ON_PACE_SHARE, ON_PACE_MIN_CENTS)) return { status: 'on-pace', gap: 0 };
  return gap > 0 ? { status: 'ahead', gap } : { status: 'under', gap: -gap };
};

// A budget row's pace, given what was expected of it ({expected, projected}: evenExpectation)
export const budgetPace = (row, { expected, projected }) => {
  const effective = effectiveCents(row);
  return {
    effective,
    spent:       row.spent_cents,
    carriedOver: row.carried_over_cents,
    expected,
    projected,
    ...paceStatus(row.spent_cents, expected, effective),
  };
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
