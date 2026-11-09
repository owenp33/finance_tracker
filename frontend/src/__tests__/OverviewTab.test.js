import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InsightsView from '../components/InsightsView';
import { CategoryColorProvider } from '../CategoryColorContext';

// jsdom has no layout, so each chart gets a fixed size instead of measuring its container
jest.mock('recharts', () => {
  const actual = jest.requireActual('recharts');
  const { cloneElement } = jest.requireActual('react');
  return { ...actual, ResponsiveContainer: ({ children, height }) => cloneElement(children, { width: 300, height }) };
});

const tx = (date, amount, category, vendor, flags) => ({
  id: `${date}-${category}-${vendor}`, account_id: 1, date, amount, amount_cents: Math.round(amount * 100),
  category, vendor, is_transfer: false, is_reimbursement: false, ...flags,
});
const spend = (date, category, dollars) => tx(date, -dollars, category, `${category} shop`);

// Sep and Oct 2026, and Nov so far (today is Nov 8): ten spending categories, two paychecks, a
// Groceries reimbursement and a transfer
const TRANSACTIONS = [
  tx('2026-09-01', 2000, 'Paycheck', 'Employer'),
  tx('2026-10-01', 2000, 'Paycheck', 'Employer'),
  spend('2026-09-03', 'Rent', 900), spend('2026-10-03', 'Rent', 900), spend('2026-11-03', 'Rent', 900),
  spend('2026-09-10', 'Groceries', 300), spend('2026-10-10', 'Groceries', 400), spend('2026-11-05', 'Groceries', 100),
  tx('2026-10-15', 50, 'Groceries', 'Cub refund', { is_reimbursement: true }),
  spend('2026-09-12', 'Gas', 100), spend('2026-10-12', 'Gas', 140),
  spend('2026-09-14', 'Dining', 60), spend('2026-10-14', 'Dining', 40),
  spend('2026-09-20', 'Fun', 50), spend('2026-10-20', 'Fun', 80),
  spend('2026-09-21', 'Subscriptions', 20), spend('2026-10-21', 'Subscriptions', 20),
  spend('2026-09-22', 'Medical', 87),
  spend('2026-10-23', 'Shopping', 30),
  spend('2026-10-24', 'Gifts', 25),
  spend('2026-09-25', 'Pets', 15),
  tx('2026-10-26', -500, 'Transfer', 'To savings', { is_transfer: true }),
];

let user;
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 10, 8, 12));   // Nov 8, 2026
  user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
});
afterEach(() => jest.useRealTimers());

const renderOverview = (transactions = TRANSACTIONS) => render(
  <CategoryColorProvider>
    <InsightsView transactions={transactions} accounts={[{ id: 1, account_name: 'Checking' }]} recurring={[]} />
  </CategoryColorProvider>
);

const spending = () => screen.getByRole('heading', { name: 'Spending by category' }).closest('section');
const panelText = () => [...spending().querySelectorAll('.category-panel')].map(panel =>
  [panel.querySelector('strong').textContent, panel.querySelector('.category-panel-label').textContent]);
const cells = (table) => [...table.querySelectorAll('tr')].map(tr => [...tr.querySelectorAll('th, td')].map(c => c.textContent));

test('a small chart per category: the top 8, then Other, each with its last full month against its average', () => {
  renderOverview();
  expect(panelText()).toEqual([
    ['Rent', 'Oct: $900, about its $900 average'],
    ['Groceries', 'Oct: $350, 8% above its $325 average'],
    ['Gas', 'Oct: $140, 17% above its $120 average'],
    ['Fun', 'Oct: $80, 23% above its $65 average'],
    ['Dining', 'Oct: $40, 20% below its $50 average'],
    ['Medical', 'Oct: $0, 100% below its $44 average'],
    ['Subscriptions', 'Oct: $20, about its $20 average'],
    ['Shopping', 'Oct: $30, 100% above its $15 average'],
    ['Other', 'Oct: $25, 25% above its $20 average'],
  ]);
  expect(within(spending()).getByText('Gifts, Pets')).toBeInTheDocument();
});

test("the panels take reimbursements off, and say how far that puts them below Total Expenses", () => {
  renderOverview();
  expect(within(spending()).getByText(
    'Reimbursements are taken off their categories, so these add up to $4,117.00, $50.00 less than Total Expenses.',
  )).toBeInTheDocument();
});

test('each panel draws a bar per month, the partial month lighter, and a dashed average line', () => {
  renderOverview();
  const groceries = spending().querySelectorAll('.category-panel')[1];
  expect(groceries.querySelectorAll('.category-bar')).toHaveLength(3);
  expect(groceries.querySelectorAll('.category-bar.partial')).toHaveLength(1);
  expect(groceries.querySelector('.category-average')).not.toBeNull();
});

test('"View as table" lists every panel', async () => {
  renderOverview();
  await user.click(within(spending()).getByText('View as table'));
  expect(cells(within(spending()).getByRole('table')).slice(0, 3)).toEqual([
    ['Category', 'Total', 'Monthly average', 'Last full month (Oct 2026)', 'Transactions'],
    ['Rent', '$2,700.00', '$900.00', '$900.00', '3'],
    ['Groceries', '$750.00', '$325.00', '$350.00', '3'],
  ]);
});

test('income is one line instead of a pie, and the pies are gone', () => {
  renderOverview();
  expect(screen.getByText('Largest income category: Paycheck, $4,000.00 of $4,050.00 (99%)')).toBeInTheDocument();
  expect(screen.queryByText('Income by Category')).not.toBeInTheDocument();
  expect(screen.queryByText('Spending by Category')).not.toBeInTheDocument();
  expect(screen.queryByText('Spending Breakdown')).not.toBeInTheDocument();
});

test('without spending, the section says so', () => {
  renderOverview([tx('2026-10-01', 2000, 'Paycheck', 'Employer')]);
  expect(within(spending()).getByText('No spending in this period.')).toBeInTheDocument();
  expect(screen.getByText('All income is in one category: Paycheck ($2,000.00)')).toBeInTheDocument();
});
