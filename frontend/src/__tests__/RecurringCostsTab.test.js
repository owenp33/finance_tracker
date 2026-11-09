import { render, screen, within, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InsightsView from '../components/InsightsView';
import { CategoryColorProvider } from '../CategoryColorContext';
import { getProjection } from '../api/recurring';

jest.mock('../api/recurring');

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

// What GET /recurring/projection lists from Nov 5, 2026 through Feb 28, 2027
const occurrence = (recurringId, date) => ({ recurring_id: recurringId, account_id: 1, date, vendor: 'Vendor', category: 'Bills', amount: -1 });
const OCCURRENCES = [
  ...['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28'].map(d => occurrence(5, d)),
  occurrence(6, '2026-11-09'),                                                       // Allina's last
  ...['2026-12-02', '2027-01-02', '2027-02-02'].map(d => occurrence(7, d)),
  ...['2026-12-01', '2026-12-15', '2026-12-29', '2027-01-12', '2027-01-26', '2027-02-09', '2027-02-23'].map(d => occurrence(13, d)),
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
  getProjection.mockResolvedValue(OCCURRENCES);
});
afterEach(() => jest.useRealTimers());

// Opens Insights → Recurring, then lets the projection arrive
const openTab = async ({ recurring = TEMPLATES, transactions = TRANSACTIONS, onError = jest.fn() } = {}) => {
  render(
    <CategoryColorProvider>
      <InsightsView transactions={transactions} accounts={ACCOUNTS} recurring={recurring} onError={onError} />
    </CategoryColorProvider>
  );
  await user.click(screen.getByRole('button', { name: 'Recurring' }));
  await act(async () => {});
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

const section = (heading) => screen.getByRole('heading', { name: heading }).closest('section');

test('"View as table" lists every series', async () => {
  await openTab();
  await user.click(within(section('Cost per month, by series')).getByText('View as table'));
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

describe('the timeline', () => {
  const timelineRows = async () => {
    await user.click(within(section('Timeline')).getByText('View as table'));
    return cells(screen.getByRole('table', { name: 'Recurring series timeline' }));
  };
  const HEADER = ['Series', 'Account', 'First payment', 'Last payment', 'Payments', 'Amount changes', 'Extra payments', 'Still scheduled'];

  test("it asks what's still scheduled through the end of the third month ahead", async () => {
    await openTab();
    await waitFor(() => expect(getProjection).toHaveBeenCalledWith(115));     // Nov 5 through Feb 28
  });

  test('it shows the active series, earliest first, income included', async () => {
    await openTab();
    await within(section('Timeline')).findByText('Through Nov 9, 2026');      // the projection has arrived
    expect(await timelineRows()).toEqual([
      HEADER,
      ['ASPIRE', 'Checking', 'Oct 31, 2025', 'Oct 28, 2026', '15', '4', '2', 'Ongoing'],
      ['Anthropic', 'Discover', 'Apr 2, 2026', 'Nov 2, 2026', '8', '0', '0', 'Ongoing'],
      ['Allina Health', 'Checking', 'Jul 20, 2026', 'Oct 26, 2026', '7', '0', '0', 'Through Nov 9, 2026'],
      ['HLWW School District (income)', 'Savings', '—', '—', '0', '0', '0', 'Ongoing'],
    ]);
  });

  test('Ended and All switch which series show', async () => {
    await openTab();
    await user.click(within(section('Timeline')).getByRole('button', { name: 'Ended' }));
    expect(within(section('Timeline')).getByRole('button', { name: 'Ended' })).toHaveAttribute('aria-pressed', 'true');
    expect((await timelineRows()).map(row => [row[0], row[7]])).toEqual([
      ['Series', 'Still scheduled'],
      ['Millenium Apartments', 'Ended Sep 2026'],
      ['Shelby Jackson LLC', 'Ended Jul 2025'],
    ]);
    await user.click(within(section('Timeline')).getByRole('button', { name: 'All' }));
    expect(cells(screen.getByRole('table', { name: 'Recurring series timeline' }))).toHaveLength(7);
  });

  test("the rows mark amount changes with rings and extra payments with dots, and today's line is labelled", async () => {
    await openTab();
    const chart = section('Timeline');
    expect(chart.querySelectorAll('.timeline-ring')).toHaveLength(4);
    expect(chart.querySelectorAll('.timeline-dot')).toHaveLength(2);
    expect(within(chart).getByText('Today')).toBeInTheDocument();
    expect(within(chart).getByText('HLWW School District · Savings · income')).toBeInTheDocument();
  });

  test('with no active series, it says so', async () => {
    await openTab({ recurring: [MILLENIUM] });
    expect(within(section('Timeline')).getByText('No active series.')).toBeInTheDocument();
    await user.click(within(section('Timeline')).getByRole('button', { name: 'Ended' }));
    expect(within(section('Timeline')).getByText('Millenium Apartments · Checking · ended Sep 2026')).toBeInTheDocument();
  });

  test("a projection that fails is reported, and what's posted still shows", async () => {
    getProjection.mockRejectedValue(new Error('Could not load the projection'));
    const onError = jest.fn();
    await openTab({ onError });
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Could not load the projection'));
    expect((await timelineRows())[1].slice(0, 5)).toEqual(['ASPIRE', 'Checking', 'Oct 31, 2025', 'Oct 28, 2026', '15']);
  });
});
