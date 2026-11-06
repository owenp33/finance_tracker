import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InsightsView from '../components/InsightsView';
import { CategoryColorProvider } from '../CategoryColorContext';

// jsdom has no layout, so the chart gets a fixed size instead of measuring its container
jest.mock('recharts', () => {
  const actual = jest.requireActual('recharts');
  const { cloneElement } = jest.requireActual('react');
  return { ...actual, ResponsiveContainer: ({ children, height }) => cloneElement(children, { width: 800, height }) };
});

const template = (overrides) => ({
  id: 5, account_id: 1, date: '2025-01-31', vendor: 'ASPIRE', category: 'Loan', amount: -75, notes: '',
  next_date: '2026-11-30', last_date: '2026-10-31', frequency: 1, frequency_unit: 'months', number: -1, idx: 36,
  ...overrides,
});

const payment = (recurringId, date, amount) => ({
  id: `${recurringId}-${date}`, account_id: 1, date, vendor: 'Vendor', category: 'Bills', notes: '',
  amount, amount_cents: Math.round(amount * 100), recurring_id: recurringId, is_transfer: false, is_reimbursement: false,
});

const monthsFrom = (from, count) => Array.from({ length: count }, (_, i) => {
  const [year, month] = from.split('-').map(Number);
  const d = new Date(year, month - 1 + i, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
});

const ASPIRE = template();
const ALLINA = template({
  id: 6, vendor: 'Allina Health', category: 'Medical', amount: -87.38, frequency: 14, frequency_unit: 'days',
  number: 8, idx: 8, date: '2026-07-20', next_date: '2026-11-09',
});
const ANTHROPIC = template({ id: 7, account_id: 2, vendor: 'Anthropic', category: 'Subscriptions', amount: -20, date: '2026-04-02' });
const MILLENIUM = template({ id: 10, vendor: 'Millenium Apartments', category: 'Rent', amount: -652.50, number: 12, idx: 13 });
const SHELBY = template({
  id: 11, vendor: 'Shelby Jackson LLC', category: 'Rent', amount: -900, number: 7, idx: 8, last_date: '2025-07-01',
});
const PAYCHECK = template({
  id: 13, account_id: 3, vendor: 'HLWW School District', category: 'Income', amount: 1700, frequency: 14,
  frequency_unit: 'days', date: '2026-12-01', next_date: '2026-12-01', idx: 1,
});
const TEMPLATES = [ASPIRE, ALLINA, ANTHROPIC, MILLENIUM, SHELBY, PAYCHECK];

const TRANSACTIONS = [
  // ASPIRE: $75 every month Nov 2025–Oct 2026 plus $105 of extra payments; one before, one not its own
  ...monthsFrom('2025-11', 12).map(m => payment(5, `${m}-28`, -75)),
  payment(5, '2026-02-12', -60),
  payment(5, '2026-06-03', -45),
  payment(5, '2025-10-31', -75),
  payment(99, '2026-03-15', -500),
  // Anthropic: $20 every month since April, this month's too
  ...monthsFrom('2026-04', 8).map(m => payment(7, `${m}-02`, -20)),
  // Allina: seven biweekly charges since July 20
  ...['2026-07-20', '2026-08-03', '2026-08-17', '2026-08-31', '2026-09-14', '2026-09-28', '2026-10-26']
    .map(d => payment(6, d, -87.38)),
  // Millenium's last two rents
  payment(10, '2026-08-02', -652.50),
  payment(10, '2026-09-02', -652.50),
];

const ACCOUNTS = [
  { id: 1, account_id: 'chk', account_name: 'Checking' },
  { id: 2, account_id: 'disc', account_name: 'Discover' },
  { id: 3, account_id: 'sav', account_name: 'Savings' },
];

let user;
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 10, 5, 12));   // Nov 5, 2026
  user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
});
afterEach(() => jest.useRealTimers());

const openTab = async ({ recurring = TEMPLATES, transactions = TRANSACTIONS } = {}) => {
  render(
    <CategoryColorProvider>
      <InsightsView transactions={transactions} accounts={ACCOUNTS} recurring={recurring} />
    </CategoryColorProvider>
  );
  await user.click(screen.getByRole('button', { name: 'Recurring' }));
};

const headline = () => screen.getByRole('heading', { name: 'Recurring costs' }).closest('section');
const cells = (table) => [...table.querySelectorAll('tr')].map(tr => [...tr.querySelectorAll('th, td')].map(c => c.textContent));

test("the headline is the active series' cost per month, at their scheduled amounts", async () => {
  await openTab();
  expect(within(headline()).getByText('$284.32/mo')).toBeInTheDocument();
  expect(within(headline()).getByText("3 active series at their scheduled amounts; income isn't counted")).toBeInTheDocument();
});

test('what a series paid beyond its schedule shows apart, not in the total', async () => {
  await openTab();
  expect(within(headline()).getByText('Not included: $105 paid to ASPIRE beyond its $75.00/mo schedule in Nov 2025–Oct 2026'))
    .toBeInTheDocument();
  expect(within(headline()).queryByText(/Anthropic|Allina/)).not.toBeInTheDocument();
});

test('each series has a bar labelled with its cost per month; ended ones say when', async () => {
  await openTab();
  const chart = screen.getByRole('heading', { name: 'Cost per month, by series' }).closest('section');
  expect(within(chart).getByText('$189.32/mo')).toBeInTheDocument();
  expect(within(chart).getByText('$652.50/mo · ended Sep 2026')).toBeInTheDocument();
  expect(within(chart).queryByText(/HLWW/)).not.toBeInTheDocument();       // income isn't a cost
});

test('"View as table" lists every series', async () => {
  await openTab();
  await user.click(screen.getByText('View as table'));
  expect(cells(screen.getByRole('table', { name: 'Recurring costs per month' }))).toEqual([
    ['Series', 'Account', 'Charged', 'Per month', 'Status', 'Paid beyond schedule'],
    ['Allina Health', 'Checking', '$87.38 biweekly', '$189.32', 'Active', '—'],
    ['ASPIRE', 'Checking', '$75.00 monthly', '$75.00', 'Active', '$105 in Nov 2025–Oct 2026'],
    ['Anthropic', 'Discover', '$20.00 monthly', '$20.00', 'Active', '—'],
    ['Shelby Jackson LLC', 'Checking', '$900.00 monthly', '$900.00', 'Ended Jul 2025', '—'],
    ['Millenium Apartments', 'Checking', '$652.50 monthly', '$652.50', 'Ended Sep 2026', '—'],
  ]);
});

test('with no active costs, the headline says so', async () => {
  await openTab({ recurring: [MILLENIUM, PAYCHECK] });
  expect(within(headline()).getByText('No active recurring costs')).toBeInTheDocument();
  expect(within(headline()).queryByText(/\/mo/)).not.toBeInTheDocument();
});

test('with no recurring series at all, the chart says so', async () => {
  await openTab({ recurring: [], transactions: [] });
  const chart = screen.getByRole('heading', { name: 'Cost per month, by series' }).closest('section');
  expect(within(chart).getByText('No recurring costs yet.')).toBeInTheDocument();
  expect(screen.queryByText('View as table')).not.toBeInTheDocument();
});
