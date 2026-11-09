import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InsightsView from '../components/InsightsView';
import { BalanceTooltip } from '../components/insights/charts/BalanceChart';
import { CategoryColorProvider } from '../CategoryColorContext';
import { getBalances } from '../api/balances';

jest.mock('../api/balances');

// jsdom has no layout, so the chart gets a fixed size instead of measuring its container
jest.mock('recharts', () => {
  const actual = jest.requireActual('recharts');
  const { cloneElement } = jest.requireActual('react');
  return { ...actual, ResponsiveContainer: ({ children, height }) => cloneElement(children, { width: 800, height }) };
});

// A GET /api/balances entry: `days` as [date, cents]
const entry = (id, name, openingCents, days) => {
  const closing = days.length ? days[days.length - 1][1] : openingCents;
  return {
    id, account_name: name, opening: openingCents / 100, opening_cents: openingCents,
    days: days.map(([date, cents]) => ({ date, balance: cents / 100, balance_cents: cents })),
    closing: closing / 100, closing_cents: closing,
  };
};

const DISCOVER = entry(5, "Owen's Discover", 0, [['2026-02-10', -50000], ['2026-11-05', -85245]]);
const CHECKING = entry(6, "Owen's Checking", 0, [['2025-01-01', -98541], ['2026-05-01', 500000], ['2026-10-31', 727413]]);
const SAVINGS = entry(7, "Owen's Savings", 707429, [['2025-07-11', 49312], ['2026-09-28', 300000]]);
const BALANCES = [DISCOVER, CHECKING, SAVINGS];

// GET /api/accounts: current balances, which the histories end at
const ACCOUNTS = [
  { id: 5, account_id: 'disc', account_name: "Owen's Discover", balance: -852.45 },
  { id: 6, account_id: 'chk', account_name: "Owen's Checking", balance: 7274.13 },
  { id: 7, account_id: 'sav', account_name: "Owen's Savings", balance: 3000 },
];

let user;
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 10, 8, 12));   // Nov 8, 2026
  user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  getBalances.mockResolvedValue(BALANCES);
});
afterEach(() => jest.useRealTimers());

// Opens Insights → Accounts and waits for the balances
const openTab = async ({ accounts = ACCOUNTS, onError = jest.fn() } = {}) => {
  render(
    <CategoryColorProvider>
      <InsightsView transactions={[]} accounts={accounts} recurring={[]} onError={onError} />
    </CategoryColorProvider>
  );
  await user.click(screen.getByRole('button', { name: 'Accounts' }));
  await waitFor(() => expect(screen.queryByText('Loading balances…')).not.toBeInTheDocument());
};

const tab = () => screen.getByRole('heading', { name: /^Balance/ }).closest('section');
const summary = () => [...tab().querySelectorAll('.balance-now, .balance-change')].map(e => e.textContent);
const pick = (name) => user.click(within(tab()).getByRole('button', { name }));
const cells = (table) => [...table.querySelectorAll('tr')].map(tr => [...tr.querySelectorAll('th, td')].map(c => c.textContent));
const tableRows = async () => {
  await user.click(within(tab()).getByText('View as table'));
  return cells(screen.getByRole('table', { name: /^Balance by day/ }));
};

test('it loads the balances once and opens on net position over the last year', async () => {
  await openTab();
  await waitFor(() => expect(getBalances).toHaveBeenCalledTimes(1));
  expect(within(tab()).getByRole('button', { name: 'Net position' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(tab()).getByRole('button', { name: '1Y' })).toHaveAttribute('aria-pressed', 'true');
  expect(summary()).toEqual(['$9,421.68', 'Up $9,913.97 since Nov 8, 2025']);
  expect(within(tab()).queryByText(/This history ends at/)).not.toBeInTheDocument();
});

test('"View as table" lists each day in the range with its change', async () => {
  await openTab();
  expect(await tableRows()).toEqual([
    ['Date', 'End-of-day balance', 'Change that day'],
    ['Feb 10, 2026', '-$992.29', '-$500.00'],
    ['May 1, 2026', '$4,993.12', '+$5,985.41'],
    ['Sep 28, 2026', '$7,500.00', '+$2,506.88'],
    ['Oct 31, 2026', '$9,774.13', '+$2,274.13'],
    ['Nov 5, 2026', '$9,421.68', '-$352.45'],
  ]);
});

test('an account shows its own balance, and a shorter range starts later', async () => {
  await openTab();
  await pick("Owen's Checking");
  await pick('3M');
  expect(summary()).toEqual(['$7,274.13', 'Up $2,274.13 since Aug 8, 2026']);
  expect((await tableRows()).slice(1)).toEqual([['Oct 31, 2026', '$7,274.13', '+$2,274.13']]);
});

test('All starts at the first day with a balance change', async () => {
  await openTab();
  await pick("Owen's Discover");
  await pick('All');
  expect(summary()).toEqual(['-$852.45', 'Down $852.45 since Feb 10, 2026']);
});

test('the chart steps from day to day, marks $0 when the balance crosses it, and has a brush to zoom', async () => {
  await openTab();
  expect(tab().querySelector('.balance-line .recharts-line-curve')).not.toBeNull();
  expect(tab().querySelector('.balance-zero-line')).not.toBeNull();
  expect(tab().querySelector('.recharts-brush')).not.toBeNull();
  await pick("Owen's Checking");
  await pick('3M');
  expect(tab().querySelector('.balance-zero-line')).toBeNull();          // $5,000 to $7,274.13
});

test("a history that doesn't end at the account's current balance says so", async () => {
  await openTab({ accounts: ACCOUNTS.map(a => (a.id === 6 ? { ...a, balance: 7000 } : a)) });
  expect(within(tab()).getByText('This history ends at $9,421.68, but your accounts add up to $9,147.55.')).toBeInTheDocument();
  await pick("Owen's Checking");
  expect(within(tab()).getByText("This history ends at $7,274.13, but the account's balance is $7,000.00."))
    .toBeInTheDocument();
});

test('a failed load is reported, and the tab says there is nothing to show', async () => {
  getBalances.mockRejectedValue(new Error('Could not load balances'));
  const onError = jest.fn();
  await openTab({ onError });
  await waitFor(() => expect(onError).toHaveBeenCalledWith('Could not load balances'));
  expect(screen.getByText('No balances to show.')).toBeInTheDocument();
});

test("the tooltip gives the day's balance and its transactions in the accounts shown", () => {
  const tx = (id, accountId, date, vendor, amount) => ({ id, account_id: accountId, date, vendor, amount_cents: Math.round(amount * 100) });
  const transactions = [
    tx(1, 6, '2026-10-31', 'Paycheck', 1250),
    tx(2, 6, '2026-10-31', 'Cub Foods', -42.10),
    tx(3, 5, '2026-10-31', 'Discover only', -9),           // another account
    tx(4, 6, '2026-10-30', 'The day before', -1),
  ];
  render(<BalanceTooltip active payload={[{ payload: { date: '2026-10-31', cents: 727413, kind: 'day' } }]}
    transactions={transactions} accountIds={[6]} />);
  const tip = screen.getByRole('tooltip');
  expect([...tip.querySelectorAll('strong, .tip-amount, li')].map(e => e.textContent)).toEqual([
    'Oct 31, 2026', '$7,274.13', 'Paycheck+$1,250.00', 'Cub Foods-$42.10',
  ]);
});
