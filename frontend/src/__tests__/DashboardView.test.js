import { render, screen } from '@testing-library/react';
import DashboardView from '../components/DashboardView';
import { CategoryColorProvider } from '../CategoryColorContext';

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

beforeEach(() => jest.useFakeTimers().setSystemTime(new Date(2026, 10, 5, 12)));   // Nov 5, 2026
afterEach(() => jest.useRealTimers());

const renderDashboard = ({ transactions = TRANSACTIONS, budgetData = BUDGETS } = {}) => render(
  <CategoryColorProvider>
    <DashboardView transactions={transactions} budgetData={budgetData} upcoming={[]} onNavigate={jest.fn()} />
  </CategoryColorProvider>
);

const card = (title) => {
  const element = screen.getByRole('heading', { name: title }).closest('.stat-card');
  return [...element.querySelectorAll('.value, .stat-sub')].map(e => e.textContent);
};

test("the cards cover this month so far, each against the same days of last month", () => {
  renderDashboard();
  expect(card('Income this month')).toEqual(['$1,280.00', '$280 more than Oct 1–5']);
  expect(card('Expenses this month')).toEqual(['$389.40', '$45 less than Oct 1–5']);
  expect(card('Net this month')).toEqual(['$890.60', '$325 more than Oct 1–5']);
  expect(screen.queryByText('Total Transactions')).not.toBeInTheDocument();
});

test("left to spend is this month's budgets less what they've spent", () => {
  renderDashboard();
  expect(card('Left to spend this month')).toEqual(['$90.60', 'of $450.00 budgeted']);
});

test('spending past the budgets overall leaves a negative amount, marked over', () => {
  renderDashboard({ budgetData: [budget(1, 'Fun', 50, 89.40)] });
  expect(card('Left to spend this month')).toEqual(['-$39.40', 'of $50.00 budgeted']);
  const value = screen.getByRole('heading', { name: 'Left to spend this month' }).closest('.stat-card').querySelector('.value');
  expect(value).toHaveClass('over');
});

test('without budgets this month, left to spend says so', () => {
  renderDashboard({ budgetData: [] });
  expect(card('Left to spend this month')).toEqual(['—', 'No budgets this month']);
});

test('a change of under a dollar reads as about the same', () => {
  renderDashboard({ transactions: [tx(1, '2026-11-02', -100.40), tx(2, '2026-10-02', -100)] });
  expect(card('Expenses this month')).toEqual(['$100.40', 'About the same as Oct 1–5']);
});

test("on a month's last day, the comparison is the whole of a shorter last month", () => {
  jest.setSystemTime(new Date(2026, 11, 31, 12));   // Dec 31, against Nov 1–30
  renderDashboard({ transactions: [], budgetData: [] });
  expect(card('Income this month')).toEqual(['$0.00', 'About the same as Nov 1–30']);
});
