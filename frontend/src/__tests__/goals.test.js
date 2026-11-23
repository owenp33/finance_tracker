import {
  GOAL_MONTHS_CAP, PAYOFF_SHOWN_MONTHS, monthlyRoom, regularPayments, goalPlan, loanPayoff, planGoals, goalTimeline,
  activeSaving, movedThisMonth, forecastAgainstGoal, goalDips,
} from '../utils/goals';

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

  describe("a loan's payoff, with and without the extra", () => {
    const payoff = (loanGoal, loanPlan) => loanPayoff(loanGoal, loanPlan, { accounts: ACCOUNTS, recurring: RECURRING, today: TODAY });

    test("runs until the plan pays it off; without the extra, what's owed grows when the interest is more than the payments", () => {
      const [, loanPlan] = plan([SAVINGS_GOAL, LOAN_GOAL], 260000);       // paid off 33 months from now
      const result = payoff(LOAN_GOAL, loanPlan);
      expect(result).toMatchObject({ regularCents: 7500, extraCents: 260000, extraFrom: '2027-02', reachMonth: '2029-08',
                                     withoutReachMonth: null, growing: true });
      expect(result.months).toHaveLength(34);
      // Now; then Dec 1's interest of $419.96 less the $75.00 payment, Jan likewise; the extra starts in February
      expect(result.months.slice(0, 4)).toEqual([
        { month: '2026-11', withExtra: 7521700, without: 7521700 },
        { month: '2026-12', withExtra: 7556196, without: 7556196 },
        { month: '2027-01', withExtra: 7590885, without: 7590885 },
        { month: '2027-02', withExtra: 7365767, without: 7625767 },
      ]);
      expect(result.months[33]).toEqual({ month: '2029-08', withExtra: 0, without: 8767888 });   // $50.38 over shows as $0 owed
      expect([result.interestWith, result.interestWithout]).toEqual([780762, 1493688]);
    });

    test('regular payments that pay it off on their own say when', () => {
      // $1,000.00 owed, no interest, $75.00 a month from its series plus $100.00 of its own: 6 months; without it, 14
      const small = { ...LOAN_GOAL, balance_cents: -100000, remaining_cents: 100000, monthly_cents: 10000 };
      const accounts = [{ id: 16, kind: 'loan', apr: null }];
      const [smallPlan] = goalPlan([small], { roomCents: 260000, accounts, recurring: RECURRING, today: TODAY });
      const result = loanPayoff(small, smallPlan, { accounts, recurring: RECURRING, today: TODAY });
      expect(result).toMatchObject({ extraCents: 10000, extraFrom: '2026-12', reachMonth: '2027-05', withoutReachMonth: '2028-01',
                                     growing: false, interestWith: 0, interestWithout: 0 });
      expect(result.months.map(m => m.withExtra)).toEqual([100000, 82500, 65000, 47500, 30000, 12500, 0]);
      expect(result.months.map(m => m.without)).toEqual([100000, 92500, 85000, 77500, 70000, 62500, 55000]);
    });

    test('with nothing extra going toward it, both paths are the regular payments, shown over 10 years', () => {
      const [, loanPlan] = plan([SAVINGS_GOAL, LOAN_GOAL], -3000);         // Savings isn't reached at this pace
      const result = payoff(LOAN_GOAL, loanPlan);
      expect(result).toMatchObject({ extraCents: 0, extraFrom: null, reachMonth: null, withoutReachMonth: null, growing: true,
                                     interestWith: 6773193, interestWithout: 6773193 });
      expect(PAYOFF_SHOWN_MONTHS).toBe(120);
      expect(result.months).toHaveLength(121);
      expect(result.months[120]).toEqual({ month: '2036-11', withExtra: 13394893, without: 13394893 });
    });
  });

  describe('the plan, as Budgeting and Insights both work it out', () => {
    // $2,600.00 of scheduled income in Savings each month over the next 90 days: $2,600.00 of room a month
    const occurrences = ['2026-12-01', '2027-01-01', '2027-02-01'].map(date => ({
      recurring_id: 13, account_id: 7, date, vendor: 'Paycheck', category: 'Income', amount: 2600,
    }));
    const inputs = { accounts: ACCOUNTS, transactions: [], recurring: RECURRING, occurrences, today: TODAY };

    test("the room, each goal's plan, and each loan goal's payoff", () => {
      const result = planGoals({ goals: [SAVINGS_GOAL, LOAN_GOAL], ...inputs });
      const plans = plan([SAVINGS_GOAL, LOAN_GOAL], 260000);
      expect(result).toEqual({
        room: 260000, plans,
        payoffs: [null, loanPayoff(LOAN_GOAL, plans[1], { accounts: ACCOUNTS, recurring: RECURRING, today: TODAY })],
      });
    });

    test('before the goals load, the room alone', () => {
      expect(planGoals({ goals: null, ...inputs })).toEqual({ room: 260000, plans: [], payoffs: [] });
    });
  });

  describe("the plan's timeline, for Insights", () => {
    const timeline = (goals, roomCents, accounts = ACCOUNTS) => goalTimeline(
      goals, goalPlan(goals, { roomCents, accounts, recurring: RECURRING, today: TODAY }),
      { accounts, recurring: RECURRING, today: TODAY });

    test("each goal's path from now until the last is reached, where the money goes each month, and the hand-off", () => {
      const result = timeline([SAVINGS_GOAL, LOAN_GOAL], 260000);
      // Savings is reached in January (2 months), the loan 33 months from now (Aug 2029)
      expect(result.months).toHaveLength(34);
      expect([result.months[0], result.months[33]]).toEqual(['2026-11', '2029-08']);
      const [savings, loan] = result.goals;
      // $3,000.00, then $2,600.00 a month up to its $7,500.00 target, where it stays
      expect(savings).toMatchObject({ id: 1, owed: false, target: 750000 });
      expect(savings.path).toEqual([300000, 560000, 750000, ...Array(31).fill(750000)]);
      // What the loan owes: its interest and $75.00 payments, then the $2,600.00 too from February (as its payoff chart)
      expect(loan).toMatchObject({ id: 2, owed: true, target: 0 });
      expect(loan.path.slice(0, 4)).toEqual([7521700, 7556196, 7590885, 7365767]);
      expect(loan.path[33]).toBe(0);
      const [, loanPlan] = plan([SAVINGS_GOAL, LOAN_GOAL], 260000);
      expect(loan.path).toEqual(loanPayoff(LOAN_GOAL, loanPlan, { accounts: ACCOUNTS, recurring: RECURRING, today: TODAY })
        .months.map(m => m.withExtra));
      // Nothing this month; Savings in December and January, then the loan
      expect(result.funding).toEqual([
        null, { id: 1, cents: 260000 }, { id: 1, cents: 260000 }, ...Array(31).fill({ id: 2, cents: 260000 }),
      ]);
      expect(result.handoffs).toEqual([{ month: '2027-01', from: 1, to: 2 }]);
    });

    test("a loan's own amount stops once its target is reached; its regular payments go on, and the next goal takes over", () => {
      // $1,000.00 owed, no interest, a target of $500.00 owed, $75.00 a month from its series plus $100.00 of its
      // own: reached in 3 months (Feb 2027). Then Savings gets the $2,600.00: $4,500.00 to go, 2 more months
      const accounts = [{ id: 7, kind: 'bank', apr: null }, { id: 16, kind: 'loan', apr: null }];
      const small = { ...LOAN_GOAL, balance_cents: -100000, target_cents: -50000, remaining_cents: 50000, monthly_cents: 10000 };
      const result = timeline([small, SAVINGS_GOAL], 260000, accounts);
      expect(result.months).toEqual(['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04']);
      expect(result.goals.map(g => [g.id, g.target, g.path])).toEqual([
        [2, 50000, [100000, 82500, 65000, 47500, 40000, 32500]],
        [1, 750000, [300000, 300000, 300000, 300000, 560000, 750000]],
      ]);
      expect(result.funding).toEqual([
        null, { id: 2, cents: 10000 }, { id: 2, cents: 10000 }, { id: 2, cents: 10000 },
        { id: 1, cents: 260000 }, { id: 1, cents: 260000 },
      ]);
      expect(result.handoffs).toEqual([{ month: '2027-02', from: 2, to: 1 }]);
    });

    test('a reached goal has no path and hands nothing off; the next goal starts now', () => {
      const held = { ...SAVINGS_GOAL, balance_cents: 800000, remaining_cents: 0, reached: true };
      const result = timeline([held, LOAN_GOAL], 260000);
      expect(result.goals[0]).toMatchObject({ id: 1, path: null });
      expect(result.funding.slice(0, 3)).toEqual([null, { id: 2, cents: 260000 }, { id: 2, cents: 260000 }]);
      expect(result.handoffs).toEqual([]);
      // Every goal reached: nothing to draw
      expect(timeline([held], 260000)).toEqual({
        months: [], funding: [], handoffs: [], goals: [{ id: 1, goal: held, owed: false, target: 750000, path: null }],
      });
    });

    test('a goal not reached at this pace runs 10 years, with nothing going toward it', () => {
      const result = timeline([SAVINGS_GOAL, LOAN_GOAL], -3000);
      expect(result.months).toHaveLength(PAYOFF_SHOWN_MONTHS + 1);
      const [savings, loan] = result.goals;
      expect(savings.path).toEqual(Array(121).fill(300000));
      expect(loan.path[120]).toBe(13394893);           // the regular payments alone, as its payoff chart
      expect(result.funding).toEqual(Array(121).fill(null));
      expect(result.handoffs).toEqual([]);
    });
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

describe('the forecast against a goal', () => {
  const forecast = [
    { date: '2026-11-20', cents: 700000, kind: 'forecast' },
    { date: '2026-12-01', cents: 870000, kind: 'forecast' },
    { date: '2027-01-15', cents: 690000, kind: 'forecast' },
    { date: '2027-02-14', cents: 690000, kind: 'forecast-end' },
  ];

  test('a goal not reached yet: the first day the forecast gets there, if it does', () => {
    expect(forecastAgainstGoal({ reached: false, target_cents: 750000 }, forecast)).toEqual({ reachesOn: '2026-12-01', dipsOn: null });
    expect(forecastAgainstGoal({ reached: false, target_cents: 900000 }, forecast)).toEqual({ reachesOn: null, dipsOn: null });
  });

  test('a goal reached and held: the first day the forecast dips under it, if it does', () => {
    expect(forecastAgainstGoal({ reached: true, target_cents: 690000 }, forecast)).toEqual({ reachesOn: null, dipsOn: null });
    expect(forecastAgainstGoal({ reached: true, target_cents: 695000 }, forecast)).toEqual({ reachesOn: null, dipsOn: '2027-01-15' });
  });
});

describe('reached goals the forecast dips under', () => {
  test("each reached goal whose account's forecast falls under its target, with the first day it does", () => {
    const goal = (id, accountId, balanceCents, targetCents) => ({
      id, account_id: accountId, account_name: `Account ${accountId}`, account_kind: 'bank', balance_cents: balanceCents,
      target_cents: targetCents, reached: balanceCents >= targetCents,
    });
    const accounts = [{ id: 6, account_name: 'Checking', kind: 'bank', apr: null, balance: 5000 },
                      { id: 7, account_name: 'Savings', kind: 'bank', apr: null, balance: 7600 }];
    const recurring = [{ id: 9, amount: -200, frequency: 1, frequency_unit: 'months', number: -1, idx: 1 }];
    const occurrences = [{ recurring_id: 9, account_id: 7, date: '2026-12-03', vendor: 'Gym', category: 'Fun', amount: -200 }];
    const held = goal(1, 7, 760000, 750000);           // $7,600 less $200 on Dec 3: under $7,500
    const goals = [held, goal(2, 6, 500000, 400000), goal(3, 7, 760000, 900000)];   // Checking holds; the third isn't reached
    expect(goalDips(goals, { accounts, transactions: [], recurring, occurrences, today: TODAY }))
      .toEqual([{ goal: held, dipsOn: '2026-12-03' }]);
    expect(goalDips(null, { accounts, transactions: [], recurring, occurrences, today: TODAY })).toEqual([]);
  });
});
