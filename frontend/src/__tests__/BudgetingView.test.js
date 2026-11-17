import { render, screen, within, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BudgetingView from '../components/BudgetingView';
import { CategoryColorProvider } from '../CategoryColorContext';
import { getBudgetProgress, getBudgets, setScheduledPace } from '../api/budgets';
import { getProjection } from '../api/recurring';
import { getGoals } from '../api/goals';

jest.mock('../api/budgets');
jest.mock('../api/recurring');
jest.mock('../api/goals');

// A row of GET /api/budgets/progress, as the backend sends it
const progressRow = (id, category, allocated, spent, carriedOver = 0, scheduledPace = false) => {
  const cents = (dollars) => Math.round(dollars * 100);
  const remaining = cents(allocated) + cents(carriedOver) - cents(spent);
  return {
    id, category, period: '2026-10', rollover: true,
    allocated, allocated_cents: cents(allocated), carried_over: carriedOver, carried_over_cents: cents(carriedOver),
    spent, spent_cents: cents(spent), remaining: remaining / 100, remaining_cents: remaining, over_budget: remaining < 0,
    scheduled_pace: scheduledPace,
  };
};

const OCTOBER = [
  progressRow(1, 'Fun', 50, 69.40),
  progressRow(2, 'Gasoline', 200, 96),
  progressRow(3, 'Groceries', 400, 150),
  progressRow(4, 'Restaurants', 100, 76, 20),
];
const SEPTEMBER = [progressRow(5, 'Groceries', 400, 380)];

// Subscriptions ($30, on scheduled pace): Anthropic's $20 posted Oct 2, and a $5 app due Oct 28
const SUBSCRIPTIONS = progressRow(6, 'Subscriptions', 30, 20, 0, true);
const ANTHROPIC = {
  id: 11, account_id: 1, date: '2026-10-02', vendor: 'Anthropic', category: 'Subscriptions', notes: '',
  amount: -20, amount_cents: -2000, recurring_id: 3, is_transfer: false, is_reimbursement: false,
};
const APP_DUE = { recurring_id: 4, account_id: 1, date: '2026-10-28', vendor: 'App', category: 'Subscriptions', amount: -5 };

let user;

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 15, 12));   // Oct 15, 2026: 15/31 of the month
  user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  getBudgets.mockResolvedValue([]);
  getBudgetProgress.mockImplementation(async (period) => (period === '2026-09' ? SEPTEMBER : OCTOBER));
  getProjection.mockResolvedValue([]);
  getGoals.mockResolvedValue([]);
  setScheduledPace.mockResolvedValue({ success: true });
});

afterEach(() => jest.useRealTimers());

const renderView = async (transactions = [], { accounts = [], recurring = [] } = {}) => {
  render(
    <CategoryColorProvider>
      <BudgetingView transactions={transactions} onBudgetChange={jest.fn()} accounts={accounts} recurring={recurring} />
    </CategoryColorProvider>
  );
  await screen.findAllByRole('img', { name: /:/ });
};

const bar = (category) => screen.getByRole('img', { name: new RegExp(`^${category}:`) });
const pace = (category) => bar(category).closest('.budget-pace');
const paceCheckbox = (category) => within(bar(category).closest('.budget-row-card')).getByRole('checkbox', { name: 'Pace by recurring' });
const markerAt = (category) => parseFloat(pace(category).querySelector('.budget-pace-marker').style.left);
const details = (tooltip) => [...tooltip.querySelectorAll('dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent]);
const cells = (table) => [...table.querySelectorAll('tr')].map(tr => [...tr.querySelectorAll('th, td')].map(c => c.textContent));

test('each category shows its spending of its budget and its pace in words', async () => {
  await renderView();
  expect(within(pace('Groceries')).getByText('$150.00 of $400.00')).toBeInTheDocument();
  expect(within(pace('Groceries')).getByText('$44 under')).toBeInTheDocument();
  expect(within(pace('Restaurants')).getByText('$76.00 of $120.00')).toBeInTheDocument();   // $20 carried over
  expect(within(pace('Restaurants')).getByText('$18 ahead')).toBeInTheDocument();
  expect(within(pace('Gasoline')).getByText('On pace')).toBeInTheDocument();
  expect(within(pace('Fun')).getByText('Over by $19.40')).toBeInTheDocument();
  expect(bar('Groceries')).toHaveAccessibleName('Groceries: $150.00 of $400.00, $44 under');
});

test("the marker sits at today's share of the month", async () => {
  await renderView();
  expect(markerAt('Groceries')).toBeCloseTo((15 / 31) * 100, 1);
  expect(markerAt('Restaurants')).toBeCloseTo((15 / 31) * 100, 1);
});

test('the bar fills with the share spent, and over budget fills it with the hatch', async () => {
  await renderView();
  const groceries = pace('Groceries').querySelector('.budget-pace-fill');
  expect(groceries.style.width).toBe('37.5%');
  expect(groceries).not.toHaveClass('over');
  const fun = pace('Fun').querySelector('.budget-pace-fill');
  expect(fun.style.width).toBe('100%');
  expect(fun).toHaveClass('over');
});

test('hovering a bar shows the numbers behind it', async () => {
  await renderView();
  await user.hover(bar('Restaurants'));
  expect(details(screen.getByRole('tooltip'))).toEqual([
    ['Spent', '$76.00'],
    ['Budget', '$120.00'],
    ['Includes carried over', '$20.00'],
    ['Pace', 'Even'],
    ['Expected by today', '$58.06'],
    ['At this rate', '$157.07 by Oct 31'],
  ]);
  expect(bar('Restaurants')).toHaveAccessibleDescription(/Expected by today/);

  await user.unhover(bar('Restaurants'));
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});

test('focusing a bar shows the numbers too, and Escape hides them', async () => {
  await renderView();
  act(() => bar('Groceries').focus());
  expect(details(screen.getByRole('tooltip'))).toEqual([
    ['Spent', '$150.00'], ['Budget', '$400.00'], ['Pace', 'Even'],
    ['Expected by today', '$193.55'], ['At this rate', '$310.00 by Oct 31'],
  ]);
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});

test('tapping a bar shows the numbers, and tapping elsewhere hides them', async () => {
  await renderView();
  await user.click(bar('Gasoline'));
  expect(screen.getByRole('tooltip')).toBeInTheDocument();
  await user.click(screen.getByText('Category Allocations'));
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});

test('"View as table" lists every row of the chart', async () => {
  await renderView();
  await user.click(screen.getByText('View as table'));
  expect(cells(screen.getByRole('table', { name: 'Budget pace, October 2026' }))).toEqual([
    ['Category', 'Spent', 'Budget', 'Used', 'Expected by today', 'Bills still due', 'At this rate, by Oct 31', 'Status'],
    ['Fun', '$69.40', '$50.00', '139%', '$24.19', '$0.00', '$143.43', 'Over by $19.40'],
    ['Gasoline', '$96.00', '$200.00', '48%', '$96.77', '$0.00', '$198.40', 'On pace'],
    ['Groceries', '$150.00', '$400.00', '38%', '$193.55', '$0.00', '$310.00', '$44 under'],
    ['Restaurants', '$76.00', '$120.00', '63%', '$58.06', '$0.00', '$157.07', '$18 ahead'],
  ]);
});

test('a past month expects its whole budget, with nothing left to project', async () => {
  await renderView();
  await user.click(screen.getByRole('button', { name: '←' }));
  await screen.findByText('$380.00 of $400.00');

  expect(markerAt('Groceries')).toBe(100);
  expect(within(pace('Groceries')).getByText('$20 under')).toBeInTheDocument();
  await user.hover(bar('Groceries'));
  expect(details(screen.getByRole('tooltip'))).toEqual([['Spent', '$380.00'], ['Budget', '$400.00']]);
  await user.click(screen.getByText('View as table'));
  expect(cells(screen.getByRole('table', { name: 'Budget pace, September 2026' }))).toEqual([
    ['Category', 'Spent', 'Budget', 'Used', 'Status'],
    ['Groceries', '$380.00', '$400.00', '95%', '$20 under'],
  ]);
});

describe('pace by recurring', () => {
  test("each row's checkbox shows its category's setting", async () => {
    getBudgetProgress.mockResolvedValue([...OCTOBER, SUBSCRIPTIONS]);
    await renderView();
    expect(paceCheckbox('Subscriptions')).toBeChecked();
    expect(paceCheckbox('Groceries')).not.toBeChecked();
    expect(paceCheckbox('Groceries').closest('label')).not.toHaveAttribute('title');   // no hover note
  });

  test('ticking it saves the setting and reloads the rows', async () => {
    await renderView();
    await user.click(paceCheckbox('Groceries'));
    expect(setScheduledPace).toHaveBeenCalledWith('Groceries', true);
    await waitFor(() => expect(getBudgetProgress).toHaveBeenCalledTimes(2));
  });

  test('unticking it goes back to an even pace', async () => {
    getBudgetProgress.mockResolvedValue([SUBSCRIPTIONS]);
    await renderView();
    await user.click(paceCheckbox('Subscriptions'));
    expect(setScheduledPace).toHaveBeenCalledWith('Subscriptions', false);
  });

  test('a failed save says why', async () => {
    setScheduledPace.mockRejectedValue(new Error('Network error'));
    await renderView();
    await user.click(paceCheckbox('Groceries'));
    expect(await screen.findByText('Network error')).toBeInTheDocument();
  });

  test('a scheduled category expects its recurring charges by today, not an even share', async () => {
    getBudgetProgress.mockResolvedValue([SUBSCRIPTIONS]);
    getProjection.mockResolvedValue([APP_DUE]);
    await renderView([ANTHROPIC]);
    await waitFor(() => expect(getProjection).toHaveBeenCalledWith(16));   // Oct 15 through Oct 31

    await waitFor(() => expect(within(pace('Subscriptions')).getByText('On pace')).toBeInTheDocument());
    expect(markerAt('Subscriptions')).toBeCloseTo((20 / 30) * 100, 1);
    await user.hover(bar('Subscriptions'));
    expect(details(screen.getByRole('tooltip'))).toEqual([
      ['Spent', '$20.00'], ['Budget', '$30.00'], ['Pace', 'By recurring'],
      ['Expected by today', '$20.00'], ['Bills still due', '$5.00'], ['With bills still due', '$25.00 by Oct 31'],
    ]);
    await user.click(screen.getByText('View as table'));
    expect(cells(screen.getByRole('table', { name: 'Budget pace, October 2026' }))[1])
      .toEqual(['Subscriptions', '$20.00', '$30.00', '67%', '$20.00', '$5.00', '$25.00 with bills due', 'On pace']);
  });

  test('a past month paces a scheduled category by its whole budget', async () => {
    getBudgetProgress.mockResolvedValue([SUBSCRIPTIONS]);
    await renderView([ANTHROPIC]);
    await user.click(screen.getByRole('button', { name: '←' }));
    await screen.findByText('September 2026');
    await waitFor(() => expect(getBudgetProgress).toHaveBeenCalledWith('2026-09'));
    await screen.findByRole('img', { name: /^Subscriptions:/ });
    expect(markerAt('Subscriptions')).toBe(100);
    expect(within(pace('Subscriptions')).getByText('$10 under')).toBeInTheDocument();
  });
});

describe('bills still due', () => {
  // A bill due later this month, from the projection
  const bill = (category, amount, date = '2026-10-20') => ({ recurring_id: 9, account_id: 1, date, vendor: 'Bill', category, amount });
  const due = (category) => pace(category).querySelector('.budget-pace-due');

  test("a category's recurring charges still due this month show as stripes after what's spent", async () => {
    getProjection.mockResolvedValue([bill('Groceries', -50)]);
    await renderView();
    await waitFor(() => expect(due('Groceries')).not.toBeNull());

    expect(parseFloat(due('Groceries').style.left)).toBe(37.5);     // after $150 of $400
    expect(parseFloat(due('Groceries').style.width)).toBe(12.5);    // $50 of $400
    expect(due('Groceries')).not.toHaveClass('over');
    expect(within(pace('Groceries')).getByText('+ $50.00 due')).toBeInTheDocument();
    expect(bar('Groceries')).toHaveAccessibleName('Groceries: $150.00 of $400.00, $50.00 in bills still due, $44 under');
    expect(due('Gasoline')).toBeNull();

    await user.hover(bar('Groceries'));
    expect(details(screen.getByRole('tooltip'))).toEqual([
      ['Spent', '$150.00'], ['Budget', '$400.00'], ['Pace', 'Even'], ['Expected by today', '$193.55'],
      ['Bills still due', '$50.00'], ['At this rate', '$310.00 by Oct 31'],
    ]);
  });

  test('bills that would take a category over budget turn the stripes orange and say by how much', async () => {
    getProjection.mockResolvedValue([bill('Restaurants', -60)]);
    await renderView();
    await waitFor(() => expect(due('Restaurants')).not.toBeNull());

    expect(due('Restaurants')).toHaveClass('over');
    expect(parseFloat(due('Restaurants').style.width)).toBeCloseTo((44 / 120) * 100, 1);   // up to the bar's end
    expect(within(pace('Restaurants')).getByText('+ $60.00 due (over by $16.00)')).toBeInTheDocument();
  });

  test('a category already over budget has no room for stripes', async () => {
    getProjection.mockResolvedValue([bill('Fun', -10)]);
    await renderView();
    await waitFor(() => expect(within(pace('Fun')).getByText('+ $10.00 due')).toBeInTheDocument());
    expect(due('Fun')).toBeNull();
  });

  test("other months don't show this month's bills", async () => {
    getProjection.mockResolvedValue([bill('Groceries', -50)]);
    await renderView();
    await waitFor(() => expect(due('Groceries')).not.toBeNull());
    await user.click(screen.getByRole('button', { name: '←' }));
    await screen.findByText('$380.00 of $400.00');
    expect(due('Groceries')).toBeNull();
    expect(within(pace('Groceries')).queryByText(/due/)).not.toBeInTheDocument();
  });
});

describe("the active goal's saving", () => {
  // A goal on Savings with its own $500 a month; $300 went into Savings on Oct 5
  const ACCOUNTS = [{ id: 7, account_name: 'Savings', kind: 'bank', apr: null, balance: 3300 },
                    { id: 16, account_name: 'Student Loan', kind: 'loan', apr: 6.7, interest_frequency: 'monthly', balance: -75142 }];
  const goalRow = (id, accountId, name, kind, balanceCents, targetCents) => ({
    id, position: 1, account_id: accountId, account_name: name, account_kind: kind, balance: balanceCents / 100,
    balance_cents: balanceCents, target: targetCents / 100, target_cents: targetCents,
    remaining_cents: Math.max(targetCents - balanceCents, 0), monthly: 500, monthly_cents: 50000, reached: false, active: true,
  });
  const SAVED = [
    { id: 21, account_id: 7, date: '2026-10-05', vendor: 'To savings', category: 'Transfer', notes: '', amount: 300,
      amount_cents: 30000, is_transfer: true, is_reimbursement: false },
    { id: 22, account_id: 7, date: '2026-09-05', vendor: 'To savings', category: 'Transfer', notes: '', amount: 999,
      amount_cents: 99900, is_transfer: true, is_reimbursement: false },
  ];
  const saving = () => document.querySelector('.budget-goal-saving');
  const unallocated = () => [...screen.getByText('Unallocated').closest('.budget-summary-card').querySelectorAll('.budget-summary-value, .budget-summary-sub')]
    .map(e => e.textContent);

  beforeEach(() => localStorage.setItem('budget_monthly_income', '3000'));
  afterEach(() => localStorage.clear());

  test('the Goals section sits below Category Allocations', async () => {
    getGoals.mockResolvedValue([goalRow(1, 7, 'Savings', 'bank', 330000, 750000)]);
    await renderView(SAVED, { accounts: ACCOUNTS });
    await waitFor(() => expect(saving()).not.toBeNull());
    const allocations = document.querySelector('.category-allocations-card');
    const goals = document.querySelector('.goals-section');
    expect(allocations.compareDocumentPosition(goals) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(allocations.contains(goals)).toBe(false);
  });

  test("it shows beside the budgets with what's gone to it so far, and Unallocated leaves it out", async () => {
    getGoals.mockResolvedValue([goalRow(1, 7, 'Savings', 'bank', 330000, 750000)]);
    await renderView(SAVED, { accounts: ACCOUNTS });
    await waitFor(() => expect(saving()).not.toBeNull());
    expect(saving().textContent).toBe('Goal: Savings · $500.00 this month (yours) · $300.00 so far');
    // $3,000 income − $750 budgeted − $500 to the goal
    expect(unallocated()).toEqual(['$1750.00', 'after $500.00 to Savings']);
  });

  test("a loan goal's saving is an extra payment, and what's gone to it is how far it's paid down", async () => {
    getGoals.mockResolvedValue([goalRow(2, 16, 'Student Loan', 'loan', -7514200, 0)]);
    const entry = { id: 31, account_id: 16, date: '2026-10-31', vendor: 'ASPIRE', category: 'Loan', notes: '', amount: 75,
                    amount_cents: 7500, is_transfer: false, is_reimbursement: false, loan_payment_id: 30, on_loan_account: true };
    await renderView([entry], { accounts: ACCOUNTS });
    await waitFor(() => expect(saving()).not.toBeNull());
    expect(saving().textContent).toBe('Goal: Student Loan · $500.00 extra this month (yours) · $75.00 paid down so far');
  });

  test("other months show no saving, and Unallocated is income less that month's budgets", async () => {
    getGoals.mockResolvedValue([goalRow(1, 7, 'Savings', 'bank', 330000, 750000)]);
    await renderView(SAVED, { accounts: ACCOUNTS });
    await waitFor(() => expect(saving()).not.toBeNull());
    await user.click(screen.getByRole('button', { name: '←' }));
    await screen.findByText('$380.00 of $400.00');
    expect(saving()).toBeNull();
    expect(unallocated()).toEqual(['$2600.00', 'remaining to allocate']);
  });
});
