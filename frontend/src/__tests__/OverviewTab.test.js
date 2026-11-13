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

// Jun–Oct 2026 full, Nov so far: net $500, -$600, $300, $900, nothing in October, -$200 so far
const NET_TRANSACTIONS = [
  ...['06', '07', '08', '09'].map(m => tx(`2026-${m}-01`, 2000, 'Paycheck', 'Employer')),
  spend('2026-06-15', 'Rent', 1500), spend('2026-07-15', 'Rent', 2600),
  spend('2026-08-15', 'Rent', 1700), spend('2026-09-15', 'Rent', 1100),
  spend('2026-11-03', 'Groceries', 200),
  tx('2026-09-20', -500, 'Transfer', 'To savings', { is_transfer: true }),
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
    ['Groceries', 'Oct: $400, 14% above its $350 average'],
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

test("the panels don't take reimbursements off (only budgets do), so no note explains a difference", () => {
  renderOverview();
  expect(within(spending()).queryByText(/Reimbursements/)).not.toBeInTheDocument();
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
    ['Groceries', '$800.00', '$350.00', '$400.00', '3'],
  ]);
});

test('income is one line instead of a pie, and the pies are gone', () => {
  renderOverview();
  expect(screen.getByText('Largest income category: Paycheck, $4,000.00 of $4,050.00 (99%)')).toBeInTheDocument();
  expect(screen.queryByText('Income by Category')).not.toBeInTheDocument();
  expect(screen.queryByText('Spending by Category')).not.toBeInTheDocument();
  expect(screen.queryByText('Spending Breakdown')).not.toBeInTheDocument();
});

describe('net per month', () => {
  const net = () => screen.getByRole('heading', { name: 'Net per month' }).closest('section');

  test('a bar per month around $0, colored by which way it went, the partial month lighter, and a 3-month average line', () => {
    renderOverview(NET_TRANSACTIONS);
    expect(net().querySelectorAll('.net-bar')).toHaveLength(5);                // October's $0 draws no bar
    expect(net().querySelectorAll('.net-bar.negative')).toHaveLength(2);       // July, and November so far
    expect(net().querySelectorAll('.net-bar.partial')).toHaveLength(1);
    expect(net().querySelector('.net-average .recharts-line-curve')).not.toBeNull();
    expect(net().querySelector('.net-zero-line')).not.toBeNull();
    expect(screen.queryByText('Monthly Trends')).not.toBeInTheDocument();
  });

  test('"View as table" lists each month with its 3-month average', async () => {
    renderOverview(NET_TRANSACTIONS);
    await user.click(within(net()).getByText('View as table'));
    expect(cells(within(net()).getByRole('table'))).toEqual([
      ['Month', 'Money in', 'Money out', 'Net', '3-month average'],
      ['Jun 2026', '$2,000.00', '$1,500.00', '+$500.00', '—'],
      ['Jul 2026', '$2,000.00', '$2,600.00', '-$600.00', '—'],
      ['Aug 2026', '$2,000.00', '$1,700.00', '+$300.00', '+$66.67'],
      ['Sep 2026', '$2,000.00', '$1,100.00', '+$900.00', '+$200.00'],
      ['Oct 2026', '$0.00', '$0.00', '$0.00', '+$400.00'],
      ['Nov 2026 (partial)', '$0.00', '$200.00', '-$200.00', '—'],
    ]);
  });
});

test('the summary cards show whole cents, and a negative net with its sign first', () => {
  renderOverview();
  const card = (title) => screen.getByRole('heading', { name: title }).closest('.summary-card');
  expect(within(card('Total Income')).getByText('$4,050.00')).toBeInTheDocument();
  expect(within(card('Total Expenses')).getByText('$4,167.00')).toBeInTheDocument();
  expect(within(card('Total Expenses')).getByText('Avg: $391.29')).toBeInTheDocument();
  expect(within(card('Net Amount')).getByText('-$117.00')).toBeInTheDocument();
});

describe('top vendors', () => {
  const vendors = () => screen.getByRole('heading', { name: 'Top vendors' }).closest('section');
  const rows = () => [...vendors().querySelectorAll('.vendor-bar')].map(row =>
    [row.querySelector('.vendor-name').textContent, row.querySelector('.vendor-value').textContent]);

  test('horizontal bars, largest first, each name on the left and amount at the end', () => {
    renderOverview();
    expect(rows()).toEqual([
      ['Rent shop', '$2,700.00'], ['Groceries shop', '$800.00'], ['Gas shop', '$240.00'], ['Fun shop', '$130.00'],
      ['Dining shop', '$100.00'], ['Medical shop', '$87.00'], ['Subscriptions shop', '$40.00'],
      ['Shopping shop', '$30.00'], ['Gifts shop', '$25.00'], ['Pets shop', '$15.00'],
    ]);
    expect(vendors().querySelector('.vendor-fill').style.width).toBe('100%');
    expect(vendors().querySelectorAll('.vendor-fill')[1].style.width).toMatch(/^29\.6/);      // $800 of $2,700
    expect(screen.queryByText('Top 10 Vendors by Spending')).not.toBeInTheDocument();
  });

  test("clicking a vendor shows its charges, average, months and latest transactions; clicking again hides them", async () => {
    renderOverview();
    const groceries = within(vendors()).getByRole('button', { name: /^Groceries shop/ });
    await user.click(groceries);
    expect(groceries).toHaveAttribute('aria-expanded', 'true');
    const detail = vendors().querySelector('.vendor-detail');
    expect(within(detail).getByText('3 charges · average $266.67 · $800.00 in total')).toBeInTheDocument();
    expect(detail.querySelectorAll('.category-bar')).toHaveLength(3);
    const items = detail.querySelectorAll('.transaction-item');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Nov 5');
    await user.click(groceries);
    expect(vendors().querySelector('.vendor-detail')).toBeNull();
  });

  test('leaving out recurring charges keeps the loan and rent from dominating', async () => {
    renderOverview(TRANSACTIONS.map(t => (t.category === 'Rent' ? { ...t, recurring_id: 3 } : t)));
    expect(rows()[0][0]).toBe('Rent shop');
    await user.click(within(vendors()).getByLabelText('Leave out recurring charges'));
    expect(rows()[0]).toEqual(['Groceries shop', '$800.00']);
    expect(rows().map(r => r[0])).not.toContain('Rent shop');
  });

  test('"View as table" lists the vendors', async () => {
    renderOverview();
    await user.click(within(vendors()).getByText('View as table'));
    expect(cells(within(vendors()).getByRole('table')).slice(0, 3)).toEqual([
      ['Vendor', 'Total', 'Charges', 'Average charge'],
      ['Rent shop', '$2,700.00', '3', '$900.00'],
      ['Groceries shop', '$800.00', '3', '$266.67'],
    ]);
  });
});

test('without spending, the section says so', () => {
  renderOverview([tx('2026-10-01', 2000, 'Paycheck', 'Employer')]);
  expect(within(spending()).getByText('No spending in this period.')).toBeInTheDocument();
  expect(screen.getByText('All income is in one category: Paycheck ($2,000.00)')).toBeInTheDocument();
});
