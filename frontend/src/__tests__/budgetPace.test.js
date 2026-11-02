import {
  evenExpectation, scheduledExpectation, paceStatus, budgetPace, percentUsed, paceLabel,
} from '../utils/budgetPace';

// A row of GET /api/budgets/progress: $400 for Groceries, $150 spent
const row = (overrides) => ({
  category: 'Groceries', allocated_cents: 40000, carried_over_cents: 0, spent_cents: 15000, ...overrides,
});

describe('an even pace', () => {
  test('expects the same share of the budget spent as of the month passed, and projects the month end', () => {
    // Oct 15: 15/31 of $400 is $193.55; $150 at that rate is $310 by Oct 31
    expect(evenExpectation(row(), 15 / 31)).toEqual({ expected: 19355, projected: 31000, basis: 'even' });
  });

  test('counts money carried over as part of the budget', () => {
    expect(evenExpectation(row({ carried_over_cents: 2000 }), 0.5).expected).toBe(21000);
  });

  test('expects the whole budget of a past month, which ends where it is', () => {
    expect(evenExpectation(row(), 1)).toEqual({ expected: 40000, projected: 15000, basis: 'even' });
  });

  test('expects nothing of a month that has not started, and projects nothing', () => {
    expect(evenExpectation(row({ spent_cents: 0 }), 0)).toEqual({ expected: 0, projected: null, basis: 'even' });
  });
});

describe('a scheduled pace', () => {
  // Oct 15: Subscriptions ($30) has $31 spent: Anthropic's $20 (a series charge, Oct 2) and an $11 one-off
  const subscriptions = row({ category: 'Subscriptions', allocated_cents: 3000, spent_cents: 3100 });
  const charge = (overrides) => ({
    date: '2026-10-02', category: 'Subscriptions', amount_cents: -2000, recurring_id: 3, is_transfer: false, ...overrides,
  });
  const occurrence = (overrides) => ({ recurring_id: 4, date: '2026-10-28', category: 'Subscriptions', amount: -5, ...overrides });
  const expect15th = (transactions, occurrences) =>
    scheduledExpectation(subscriptions, { transactions, occurrences, period: '2026-10', today: '2026-10-15' });

  test("expects the month's recurring charges posted so far, and projects the ones still to come", () => {
    expect(expect15th([charge(), charge({ recurring_id: null, amount_cents: -1100 })], [occurrence()]))
      .toEqual({ expected: 2000, projected: 3600, basis: 'scheduled' });
  });

  test("counts only the category's series charges this month, transfers and money in left out", () => {
    expect(expect15th([
      charge(),
      charge({ category: 'Fun' }),
      charge({ date: '2026-09-02' }),
      charge({ date: '2026-11-02' }),
      charge({ is_transfer: true }),
      charge({ amount_cents: 5000 }),
    ], []).expected).toBe(2000);
  });

  test("an occurrence due today that hasn't posted yet is expected by today", () => {
    expect(expect15th([], [occurrence({ date: '2026-10-15' })])).toEqual({ expected: 500, projected: 3600, basis: 'scheduled' });
  });

  test("occurrences in another category or month, or of money in, don't count", () => {
    expect(expect15th([], [occurrence({ category: 'Fun' }), occurrence({ date: '2026-11-02' }), occurrence({ amount: 40 })]))
      .toEqual({ expected: 0, projected: 3100, basis: 'scheduled' });
  });

  test("a category with one early scheduled charge isn't called ahead", () => {
    const anthropic = row({ category: 'Subscriptions', allocated_cents: 3000, spent_cents: 2000 });
    const given = { transactions: [charge()], occurrences: [], period: '2026-10', today: '2026-10-15' };
    expect(budgetPace(anthropic, scheduledExpectation(anthropic, given)).status).toBe('on-pace');
    expect(budgetPace(anthropic, evenExpectation(anthropic, 15 / 31)).status).toBe('ahead');
  });
});

describe('the status', () => {
  test('spending past the budget is over, by the amount past it', () => {
    expect(paceStatus(6940, 2419, 5000)).toEqual({ status: 'over', gap: 1940 });
  });

  test('spending exactly the budget is not over', () => {
    expect(paceStatus(5000, 5000, 5000)).toEqual({ status: 'on-pace', gap: 0 });
  });

  test('spending more than expected is ahead of pace, and less is under it', () => {
    expect(paceStatus(7500, 5806, 12000)).toEqual({ status: 'ahead', gap: 1694 });
    expect(paceStatus(15000, 19355, 40000)).toEqual({ status: 'under', gap: 4355 });
  });

  test('within 2% of the budget of the expected spend is on pace', () => {
    expect(paceStatus(10399, 10000, 20000)).toEqual({ status: 'on-pace', gap: 0 });
    expect(paceStatus(9601, 10000, 20000)).toEqual({ status: 'on-pace', gap: 0 });
    expect(paceStatus(10400, 10000, 20000)).toEqual({ status: 'ahead', gap: 400 });
    expect(paceStatus(9600, 10000, 20000)).toEqual({ status: 'under', gap: 400 });
  });

  test('a small budget still gets a dollar of leeway, so no row reads "$0 ahead"', () => {
    expect(paceStatus(1099, 1000, 2000)).toEqual({ status: 'on-pace', gap: 0 });
    expect(paceStatus(1100, 1000, 2000)).toEqual({ status: 'ahead', gap: 100 });
  });

  test('a category with no budget is on pace until it spends anything', () => {
    expect(paceStatus(0, 0, 0)).toEqual({ status: 'on-pace', gap: 0 });
    expect(paceStatus(1, 0, 0)).toEqual({ status: 'over', gap: 1 });
  });
});

test("a row's pace puts its amounts, its expectation and its status together", () => {
  expect(budgetPace(row({ carried_over_cents: 2000 }), { expected: 20323, projected: 31000, basis: 'even' })).toEqual({
    effective: 42000, spent: 15000, carriedOver: 2000, expected: 20323, projected: 31000, basis: 'even',
    status: 'under', gap: 5323,
  });
});

test('the share of the budget used is a whole percent, and none without a budget', () => {
  expect(percentUsed({ spent: 15000, effective: 40000 })).toBe(38);
  expect(percentUsed({ spent: 6940, effective: 5000 })).toBe(139);
  expect(percentUsed({ spent: 0, effective: 0 })).toBeNull();
});

test('the label says it in words: exact when over, whole dollars for pace', () => {
  expect(paceLabel({ status: 'over', gap: 1940 })).toBe('Over by $19.40');
  expect(paceLabel({ status: 'ahead', gap: 1694 })).toBe('$17 ahead');
  expect(paceLabel({ status: 'under', gap: 4355 })).toBe('$44 under');
  expect(paceLabel({ status: 'on-pace', gap: 0 })).toBe('On pace');
});
