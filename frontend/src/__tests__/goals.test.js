import { GOAL_MONTHS_CAP, monthlyRoom, regularPayments, goalPlan, activeSaving, movedThisMonth } from '../utils/goals';

const TODAY = '2026-11-16';     // the next 90 days: through Feb 14, 2027

describe('monthly room', () => {
  test("is a third of the next 90 days' scheduled income less scheduled charges and average spending", () => {
    const occurrence = (recurringId, accountId, date, category, amount) => ({ recurring_id: recurringId, account_id: accountId,
                                                                              date, vendor: `Series ${recurringId}`, category, amount });
    const occurrences = [
      occurrence(13, 7, '2026-12-01', 'Income', 1700), occurrence(13, 7, '2027-02-14', 'Income', 1700),
      occurrence(13, 7, '2027-02-15', 'Income', 1700),                     // past the 90 days
      occurrence(5, 6, '2026-11-30', 'Loan', -75), occurrence(5, 6, '2026-12-31', 'Loan', -75), occurrence(5, 6, '2027-01-31', 'Loan', -75),
    ];
    // $90 of groceries over the last 90 days, averaged
    const transactions = [{ id: 1, account_id: 6, date: '2026-10-01', category: 'Grocery', amount_cents: -9000,
                            recurring_id: null, is_transfer: false }];
    // ($3,400.00 − $225.00 − $90.00) ÷ 3 = $1,028.33
    expect(monthlyRoom(transactions, [], occurrences, [6, 7], TODAY)).toBe(102833);
    expect(monthlyRoom(transactions, [], [], [6, 7], TODAY)).toBe(-3000);   // no income: spending only
  });
});

describe('regular payments to a loan', () => {
  test("are the monthly equivalent of the active series that pay it down", () => {
    const template = (id, amount, frequency, unit, loanAccountId, extra = {}) => ({
      id, amount, frequency, frequency_unit: unit, number: -1, idx: 1, loan_account_id: loanAccountId, ...extra,
    });
    const recurring = [
      template(5, -75, 1, 'months', 9),
      template(6, -87.38, 14, 'days', 9),                          // biweekly: × 26 / 12
      template(7, -500, 1, 'months', 9, { number: 3, idx: 4 }),    // finished
      template(8, -30, 1, 'months', 10),                           // another loan
      template(9, -20, 1, 'months', null),
    ];
    expect(regularPayments(9, recurring)).toBe(7500 + Math.round((8738 * 26) / 12));
    expect(regularPayments(11, recurring)).toBe(0);
  });
});

describe('goal plan', () => {
  // GET /api/goals rows (balances in cents) and GET /api/accounts entries
  const goal = (id, accountId, kind, balanceCents, targetCents, extra = {}) => ({
    id, account_id: accountId, account_kind: kind, balance_cents: balanceCents, target_cents: targetCents,
    remaining_cents: Math.max(targetCents - balanceCents, 0), monthly_cents: null, reached: balanceCents >= targetCents, ...extra,
  });
  const SAVINGS_GOAL = goal(1, 7, 'bank', 300000, 750000);
  const LOAN_GOAL = goal(2, 16, 'loan', -7521700, 0);
  const ACCOUNTS = [{ id: 7, kind: 'bank', apr: null }, { id: 16, kind: 'loan', apr: 6.7, interest_frequency: 'monthly' }];
  const RECURRING = [{ id: 5, amount: -75, frequency: 1, frequency_unit: 'months', number: -1, idx: 1, loan_account_id: 16 }];
  const plan = (goals, roomCents) => goalPlan(goals, { roomCents, accounts: ACCOUNTS, recurring: RECURRING, today: TODAY });

  test('the active goal gets the room each month, and the next one starts when it is reached', () => {
    // $4,500.00 to go at $2,600.00 a month: 2 months. Then the loan, charged 6.70% a year monthly and
    // paid $75.00 a month all along, gets the $2,600.00 too: paid off 33 months from now
    expect(plan([SAVINGS_GOAL, LOAN_GOAL], 260000)).toEqual([
      { id: 1, status: 'active', monthlyCents: 260000, suggestedCents: 260000, own: false, startsIn: 0, months: 2, reachMonth: '2027-01' },
      { id: 2, status: 'waiting', monthlyCents: 260000, suggestedCents: 260000, own: false, startsIn: 2, months: 33, reachMonth: '2029-08' },
    ]);
  });

  test('a held goal needs nothing, and the next one is active', () => {
    const held = { ...SAVINGS_GOAL, balance_cents: 800000, remaining_cents: 0, reached: true };
    const [first, second] = plan([held, LOAN_GOAL], 260000);
    expect(first).toEqual({ id: 1, status: 'held', monthlyCents: 0, suggestedCents: 260000, own: false, startsIn: null, months: 0, reachMonth: null });
    expect(second).toMatchObject({ id: 2, status: 'active', startsIn: 0 });
  });

  test("the goal's own monthly amount wins over the suggestion", () => {
    // $500.00 a month on top of the regular $75.00: 236 months
    expect(plan([{ ...LOAN_GOAL, monthly_cents: 50000 }], 260000)).toEqual([
      { id: 2, status: 'active', monthlyCents: 50000, suggestedCents: 260000, own: true, startsIn: 0, months: 236, reachMonth: '2046-07' },
    ]);
  });

  test("without room, or when payments don't cover the interest, a goal isn't reached at this pace, nor the ones after it", () => {
    expect(plan([SAVINGS_GOAL, LOAN_GOAL], -3000).map(p => [p.id, p.monthlyCents, p.months, p.startsIn])).toEqual([
      [1, 0, null, 0], [2, 0, null, null],
    ]);
    expect(plan([LOAN_GOAL], 0)[0].months).toBeNull();         // $75 a month is less than the interest
    expect(GOAL_MONTHS_CAP).toBe(600);
  });
});

describe('the active goal and what moved this month', () => {
  test('the active goal comes with its plan; none when every goal is reached', () => {
    const goals = [{ id: 1, reached: true }, { id: 2, reached: false }, { id: 3, reached: false }];
    const plans = [{ id: 1, status: 'held' }, { id: 2, status: 'active' }, { id: 3, status: 'waiting' }];
    expect(activeSaving(goals, plans)).toEqual({ goal: goals[1], plan: plans[1] });
    expect(activeSaving([goals[0]], [plans[0]])).toBeNull();
    expect(activeSaving(null, [])).toBeNull();
  });

  test("an account's change this month is its transactions dated this month, transfers and interest included", () => {
    const tx = (accountId, date, cents, extra = {}) => ({ account_id: accountId, date, amount_cents: cents, ...extra });
    const transactions = [
      tx(7, '2026-11-01', 170000), tx(7, '2026-11-12', -50000, { is_transfer: true }), tx(7, '2026-11-30', 1500),
      tx(7, '2026-10-31', 99900),                       // last month
      tx(6, '2026-11-05', -2000),                       // another account
    ];
    expect(movedThisMonth(transactions, 7, '2026-11')).toBe(121500);
  });
});
