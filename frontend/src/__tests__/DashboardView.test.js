import { render, screen, within, fireEvent, act, waitFor } from '@testing-library/react';
import DashboardView from '../components/DashboardView';
import { CategoryColorProvider } from '../CategoryColorContext';
import { getProjection } from '../api/recurring';
import { getGoals } from '../api/goals';

jest.mock('../api/recurring');
jest.mock('../api/goals');

const tx = (id, date, amount, overrides) => ({
  id, account_id: 1, account_name: 'Checking', date, vendor: `Vendor ${id}`, category: 'Groceries', notes: '',
  amount, amount_cents: Math.round(amount * 100), recurring_id: null, recurring_index: null,
  is_transfer: false, is_reimbursement: false, over_budget: false, ...overrides,
});

// A row of GET /api/budgets/progress for this month
const budget = (id, category, allocated, spent) => {
  const cents = (dollars) => Math.round(dollars * 100);
  const remaining = cents(allocated) - cents(spent);
  return {
    id, category, period: '2026-11', rollover: true, scheduled_pace: false,
    allocated, allocated_cents: cents(allocated), carried_over: 0, carried_over_cents: 0,
    spent, spent_cents: cents(spent), remaining: remaining / 100, remaining_cents: remaining, over_budget: remaining < 0,
  };
};

// Nov 1–5 so far, against Oct 1–5
const TRANSACTIONS = [
  tx(1, '2026-11-01', 1250, { category: 'Paycheck' }),
  tx(2, '2026-11-03', 30, { is_reimbursement: true }),                        // income in the totals
  tx(3, '2026-11-02', -300),
  tx(4, '2026-11-04', -89.40, { category: 'Fun' }),
  tx(5, '2026-11-04', -500, { category: 'Transfer', is_transfer: true }),     // never counts
  tx(6, '2026-11-05', 0),
  tx(7, '2026-11-20', -50),                                                   // later this month
  tx(8, '2026-10-02', 1000, { category: 'Paycheck' }),
  tx(9, '2026-10-05', -434.40),
  tx(10, '2026-10-06', -999),                                                 // after Oct 5
];

// Groceries' spending is lowered by the $30 reimbursement, as budget progress counts it
const BUDGETS = [budget(1, 'Fun', 50, 89.40), budget(2, 'Groceries', 400, 270)];

// Six budgets on Nov 5, 5/30 of the way through the month, against an even pace
const SIX_BUDGETS = [
  budget(1, 'Fun', 50, 89.40),          // over by $39.40
  budget(2, 'Gasoline', 150, 20),       // $5 under
  budget(3, 'Groceries', 400, 270),     // $203 ahead
  budget(4, 'Restaurants', 30, 0),      // $5 under
  budget(5, 'Shopping', 200, 0),        // $33 under
  budget(6, 'Subscriptions', 30, 20),   // $15 ahead
];

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 10, 5, 12));   // Nov 5, 2026
  getProjection.mockResolvedValue([]);
  getGoals.mockResolvedValue([]);
});
afterEach(() => jest.useRealTimers());

// Renders the Dashboard, then lets this month's projection arrive
const renderDashboard = async ({ transactions = TRANSACTIONS, budgetData = BUDGETS, onError = jest.fn(),
                                 accounts = [], recurring = [], onNavigate = jest.fn() } = {}) => {
  render(
    <CategoryColorProvider>
      <DashboardView
        transactions={transactions} budgetData={budgetData} onNavigate={onNavigate} onError={onError}
        accounts={accounts} recurring={recurring}
      />
    </CategoryColorProvider>
  );
  await act(async () => {});
};

// What GET /recurring/projection lists for the 30 days from Thursday, Nov 5, 2026
const occurrence = (recurringId, date, vendor, amount) => ({ recurring_id: recurringId, account_id: 1, date, vendor, category: 'Bills', amount });
const AGENDA = [
  occurrence(2, '2026-12-01', 'HLWW School District', 1700),
  occurrence(6, '2026-11-05', 'Allina Health', -87.38),
  occurrence(9, '2026-11-09', 'Gym', -30),
  occurrence(5, '2026-11-30', 'ASPIRE', -75),
  occurrence(7, '2026-12-02', 'Anthropic', -20),
];

const card = (title) => {
  const element = screen.getByRole('heading', { name: title }).closest('.stat-card');
  return [...element.querySelectorAll('.value, .stat-sub')].map(e => e.textContent);
};

const paceSection = () => screen.getByRole('heading', { name: 'Budget Pace' }).closest('.dashboard-col');
const paceBars = () => within(paceSection()).getAllByRole('img').map(bar => bar.getAttribute('aria-label'));

describe("this month's cards", () => {
  test('they cover this month so far, each against the same days of last month', async () => {
    await renderDashboard();
    expect(card('Income this month')).toEqual(['$1,280.00', '$280 more than Oct 1–5']);
    expect(card('Expenses this month')).toEqual(['$389.40', '$45 less than Oct 1–5']);
    expect(card('Net this month')).toEqual(['$890.60', '$325 more than Oct 1–5']);
    expect(screen.queryByText('Total Transactions')).not.toBeInTheDocument();
  });

  test("a loan account's transactions are left out of the cards, like transfers", async () => {
    await renderDashboard({ transactions: [
      ...TRANSACTIONS,
      tx(11, '2026-11-02', 75, { category: 'Loan', vendor: 'ASPIRE', on_loan_account: true }),
      tx(12, '2026-11-03', -12.5, { category: 'Loan', vendor: 'Interest', on_loan_account: true }),
    ] });
    expect(card('Income this month')).toEqual(['$1,280.00', '$280 more than Oct 1–5']);
    expect(card('Expenses this month')).toEqual(['$389.40', '$45 less than Oct 1–5']);
  });

  test("left to spend is this month's budgets less what they've spent", async () => {
    await renderDashboard();
    expect(card('Left to spend this month')).toEqual(['$90.60', 'of $450.00 budgeted']);
  });

  test('spending past the budgets overall leaves a negative amount, marked over', async () => {
    await renderDashboard({ budgetData: [budget(1, 'Fun', 50, 89.40)] });
    expect(card('Left to spend this month')).toEqual(['-$39.40', 'of $50.00 budgeted']);
    const value = screen.getByRole('heading', { name: 'Left to spend this month' }).closest('.stat-card').querySelector('.value');
    expect(value).toHaveClass('over');
  });

  test('without budgets this month, left to spend says so', async () => {
    await renderDashboard({ budgetData: [] });
    expect(card('Left to spend this month')).toEqual(['—', 'No budgets this month']);
  });

  test('a change of under a dollar reads as about the same', async () => {
    await renderDashboard({ transactions: [tx(1, '2026-11-02', -100.40), tx(2, '2026-10-02', -100)] });
    expect(card('Expenses this month')).toEqual(['$100.40', 'About the same as Oct 1–5']);
  });

  test("on a month's last day, the comparison is the whole of a shorter last month", async () => {
    jest.setSystemTime(new Date(2026, 11, 31, 12));   // Dec 31, against Nov 1–30
    await renderDashboard({ transactions: [], budgetData: [] });
    expect(card('Income this month')).toEqual(['$0.00', 'About the same as Nov 1–30']);
  });
});

describe('budget pace', () => {
  test('it shows the 5 categories furthest ahead of pace, over budget first, as many as recent transactions', async () => {
    await renderDashboard({ budgetData: SIX_BUDGETS });
    expect(paceBars()).toEqual([
      'Fun: $89.40 of $50.00, Over by $39.40',
      'Groceries: $270.00 of $400.00, $203 ahead',
      'Subscriptions: $20.00 of $30.00, $15 ahead',
      'Gasoline: $20.00 of $150.00, $5 under',
      'Restaurants: $0.00 of $30.00, $5 under',
    ]);
    expect(within(paceSection()).queryByText(/budgets/)).not.toBeInTheDocument();    // no note
    expect(screen.queryByText('Spending vs Budget')).not.toBeInTheDocument();
  });

  test('with 5 budgets or fewer, all of them show', async () => {
    await renderDashboard();
    expect(paceBars()).toEqual([
      'Fun: $89.40 of $50.00, Over by $39.40',
      'Groceries: $270.00 of $400.00, $203 ahead',
    ]);
  });

  test('it paces each budget as the Budgeting view does: by recurring when set, with bills still due', async () => {
    const subscriptions = { ...budget(1, 'Subscriptions', 30, 20), scheduled_pace: true };
    const anthropic = tx(11, '2026-11-02', -20, { category: 'Subscriptions', recurring_id: 3 });
    getProjection.mockResolvedValue([
      { recurring_id: 4, account_id: 1, date: '2026-11-20', vendor: 'Costco', category: 'Groceries', amount: -50 },
    ]);
    await renderDashboard({ transactions: [anthropic], budgetData: [subscriptions, budget(2, 'Groceries', 400, 270)] });
    expect(getProjection).toHaveBeenCalledWith(30);   // the agenda's 30 days, which cover the rest of November

    expect(paceBars()).toEqual([
      'Groceries: $270.00 of $400.00, $50.00 in bills still due, $203 ahead',
      'Subscriptions: $20.00 of $30.00, On pace',      // an even pace would say "$15 ahead"
    ]);
    fireEvent.focus(within(paceSection()).getByRole('img', { name: /^Groceries:/ }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('At this rate$1,620.00 by Nov 30');
  });

  test("a projection that fails is reported, and the bars still show what's spent", async () => {
    getProjection.mockRejectedValue(new Error('Could not load the projection'));
    const onError = jest.fn();
    await renderDashboard({ onError });
    expect(onError).toHaveBeenCalledWith('Could not load the projection');
    expect(paceBars()).toHaveLength(2);
  });

  test('without budgets this month, it says so', async () => {
    await renderDashboard({ budgetData: [] });
    expect(within(paceSection()).getByText('No budgets set for this period.')).toBeInTheDocument();
  });
});

describe('the next 30 days', () => {
  const agenda = () => screen.getByRole('heading', { name: 'Next 30 days' }).closest('section');

  test("the scheduled charges and income by week, each with its amount and the running total, and each week's total", async () => {
    getProjection.mockResolvedValue(AGENDA);
    await renderDashboard({ budgetData: [] });
    const weeks = [...agenda().querySelectorAll('.agenda-week')].map(week => ({
      heading: [week.querySelector('h4').textContent, week.querySelector('.agenda-week-total').textContent],
      rows: [...week.querySelectorAll('.agenda-item')].map(row =>
        [...row.querySelectorAll('.agenda-date, .agenda-vendor, .agenda-amount, .agenda-running')].map(e => e.textContent)),
    }));
    expect(weeks).toEqual([
      { heading: ['This week', '-$87.38'], rows: [['Today', 'Allina Health', '-$87.38', '-$87.38']] },
      { heading: ['Next week', '-$30.00'], rows: [['Mon, Nov 9', 'Gym', '-$30.00', '-$117.38']] },
      { heading: ['Week of Nov 29', '+$1,605.00'], rows: [
        ['Mon, Nov 30', 'ASPIRE', '-$75.00', '-$192.38'],
        ['Tue, Dec 1', 'HLWW School District', '+$1,700.00', '+$1,507.62'],
        ['Wed, Dec 2', 'Anthropic', '-$20.00', '+$1,487.62'],
      ] },
    ]);
    expect(agenda().querySelectorAll('.agenda-tag')).toHaveLength(5);
    expect(within(agenda()).getByText('Running total')).toBeInTheDocument();
    expect(screen.queryByText('Due This Week')).not.toBeInTheDocument();
  });

  test('with nothing scheduled, it says so', async () => {
    await renderDashboard();
    expect(within(agenda()).getByText('Nothing scheduled in the next 30 days.')).toBeInTheDocument();
  });
});

describe('the goal card', () => {
  const ACCOUNTS = [{ id: 7, account_name: 'Savings', kind: 'bank', apr: null, balance: 3000 },
                    { id: 16, account_name: 'Student Loan', kind: 'loan', apr: 6.7, interest_frequency: 'monthly', balance: -75217 }];
  const RECURRING = [{ id: 5, amount: -75, frequency: 1, frequency_unit: 'months', number: -1, idx: 1, loan_account_id: 16 }];
  const goalRow = (id, position, accountId, name, kind, balanceCents, targetCents, monthlyCents = 50000) => ({
    id, position, account_id: accountId, account_name: name, account_kind: kind, balance: balanceCents / 100,
    balance_cents: balanceCents, target: targetCents / 100, target_cents: targetCents,
    remaining_cents: Math.max(targetCents - balanceCents, 0), monthly: monthlyCents / 100, monthly_cents: monthlyCents,
    reached: balanceCents >= targetCents, active: false,
  });
  const goalCard = () => document.querySelector('.goal-card');
  const texts = () => ['h3', '.value', '.stat-sub'].map(sel => goalCard().querySelector(sel).textContent);
  const open = (goals, extra = {}) => {
    getGoals.mockResolvedValue(goals);
    return renderDashboard({ accounts: ACCOUNTS, recurring: RECURRING, ...extra });
  };

  test("the active goal: where it stands, what to leave this month, and when it's reached", async () => {
    // $4,500 to go at $500 a month: 9 months from November
    await open([goalRow(1, 1, 7, 'Savings', 'bank', 300000, 750000), goalRow(2, 2, 16, 'Student Loan', 'loan', -7521700, 0)]);
    expect(texts()).toEqual(['Savings goal', '$3,000 of $7,500', 'Leave $500.00 in Savings this month · reached by Aug 2027']);
    // "Goals →" sits on the title's line, like the other cards' links
    const header = within(goalCard()).getByRole('heading', { name: 'Savings goal' }).parentElement;
    expect(header).toHaveClass('section-header');
    expect(within(header).getByRole('button', { name: 'Goals →' })).toBeInTheDocument();
  });

  test("every card's title sits in the same header line", async () => {
    await open([goalRow(1, 1, 7, 'Savings', 'bank', 300000, 750000)]);
    const titles = [...document.querySelectorAll('.dashboard-view h3')];
    expect(titles.map(h => h.textContent)).toEqual(expect.arrayContaining(
      ['Savings goal', 'Income this month', 'Budget Pace', 'Recent Transactions', 'Next 30 days']));
    titles.forEach(h => expect(h.parentElement).toHaveClass('section-header'));
  });

  test("a loan goal: what's owed, the extra to pay this month, and when it's paid off", async () => {
    await open([goalRow(2, 1, 16, 'Student Loan', 'loan', -7521700, 0)]);
    expect(texts()).toEqual(['Student Loan goal', '$75,217 owed', 'Pay $500.00 extra this month · paid off by Jul 2046']);
  });

  test('with every goal reached, it says so; without goals, it offers to set one', async () => {
    await open([goalRow(1, 1, 7, 'Savings', 'bank', 800000, 750000)]);
    expect(texts()).toEqual(['Goals', 'All reached', 'Every goal is reached and held']);
  });

  test('a reached goal the forecast dips under gets an orange warning', async () => {
    getProjection.mockResolvedValue([{ recurring_id: 9, account_id: 7, date: '2026-11-20', vendor: 'Gym', category: 'Fun',
                                       amount: -200 }]);
    await open([goalRow(1, 1, 7, 'Savings', 'bank', 760000, 750000)], {
      accounts: [{ id: 7, account_name: 'Savings', kind: 'bank', apr: null, balance: 7600 }],
      recurring: [{ id: 9, amount: -200, frequency: 1, frequency_unit: 'months', number: -1, idx: 1 }],
      transactions: [],
    });
    expect(texts()).toEqual(['Goals', 'All reached', 'Every goal is reached and held']);
    // $7,600 less the $200 on Nov 20
    await waitFor(() => expect(goalCard().querySelector('.goal-card-warning')).not.toBeNull());
    expect([...goalCard().querySelectorAll('.goal-card-warning')].map(w => w.textContent))
      .toEqual(['Savings: forecast dips under $7,500 on Nov 20']);
  });

  test('no warning while the forecast stays at or above every reached goal', async () => {
    await open([goalRow(1, 1, 7, 'Savings', 'bank', 760000, 750000)], {
      accounts: [{ id: 7, account_name: 'Savings', kind: 'bank', apr: null, balance: 7600 }], transactions: [],
    });
    expect(goalCard().querySelector('.goal-card-warning')).toBeNull();
  });

  test('without goals, it offers to set one on Budgeting, and the link goes there', async () => {
    const onNavigate = jest.fn();
    await open([], { onNavigate });
    expect(texts()).toEqual(['Goals', '—', 'No goals yet']);
    fireEvent.click(within(goalCard()).getByRole('button', { name: 'Set a goal →' }));
    expect(onNavigate).toHaveBeenCalledWith('budgeting');
  });

  test("a goal not reached at this pace says so", async () => {
    await open([goalRow(2, 1, 16, 'Student Loan', 'loan', -7521700, 0, 0)].map(g => ({ ...g, monthly: null, monthly_cents: null })));
    expect(texts()[2]).toBe('Nothing goes toward it this month · not reached at this pace');
  });
});

describe('the 90-day projection', () => {
  const ACCOUNTS = [{ id: 6, account_name: 'Checking', kind: 'bank', apr: null, balance: 7000 },
                    { id: 7, account_name: 'Savings', kind: 'bank', apr: null, balance: 3000 }];
  const RECURRING = [{ id: 5, amount: -75, frequency: 1, frequency_unit: 'months', number: -1, idx: 1 },
                     { id: 13, amount: 1700, frequency: 14, frequency_unit: 'days', number: -1, idx: 1 }];
  const OCCURRENCES = [
    { recurring_id: 5, account_id: 6, date: '2026-11-30', vendor: 'ASPIRE', category: 'Loan', amount: -75 },
    { recurring_id: 13, account_id: 7, date: '2026-12-01', vendor: 'Paycheck', category: 'Income', amount: 1700 },
  ];
  const card = () => document.querySelector('.projection-card');

  test('sits beside the goal card, both just above Next 30 days', async () => {
    await renderDashboard({ accounts: ACCOUNTS, recurring: RECURRING });
    const row = document.querySelector('.dashboard-goal-row');
    expect([...row.children].map(child => child.classList.contains('goal-card') || child.classList.contains('projection-card')))
      .toEqual([true, true]);
    expect(row.children[0]).toHaveClass('goal-card');
    expect(document.querySelector('.stats-grid .goal-card')).toBeNull();
    const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(document.querySelector('.dashboard-columns'), row)).toBe(true);
    expect(follows(row, document.querySelector('.agenda-section'))).toBe(true);
  });

  test('shows net position at the end of the next 90 days, from today', async () => {
    getProjection.mockResolvedValue(OCCURRENCES);
    await renderDashboard({ accounts: ACCOUNTS, recurring: RECURRING, transactions: [] });
    // $10,000 today, less ASPIRE's $75 and plus the $1,700 paycheck, by Feb 3 (90 days from Nov 5)
    await waitFor(() => expect(card().querySelector('.value').textContent).toBe('$11,625'));
    expect(card().querySelector('h3').textContent).toBe('90-day projection');
    expect(card().querySelector('.stat-sub').textContent).toBe('Net position by Feb 3 · now $10,000');
  });

  test('its link goes to Insights', async () => {
    const onNavigate = jest.fn();
    await renderDashboard({ accounts: ACCOUNTS, recurring: RECURRING, onNavigate });
    fireEvent.click(within(card()).getByRole('button', { name: 'Insights →' }));
    expect(onNavigate).toHaveBeenCalledWith('insights');
  });

  test('without accounts it says so', async () => {
    await renderDashboard();
    expect(['.value', '.stat-sub'].map(sel => card().querySelector(sel).textContent)).toEqual(['—', 'No accounts yet']);
  });
});
