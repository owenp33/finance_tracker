import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InsightsView from '../components/InsightsView';
import { BalanceTooltip } from '../components/insights/charts/BalanceChart';
import { CategoryColorProvider } from '../CategoryColorContext';
import { getBalances } from '../api/balances';
import { getProjection } from '../api/recurring';

jest.mock('../api/balances');
jest.mock('../api/recurring');

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

// What GET /recurring/projection lists for the 90 days from Nov 8, 2026
const occurrence = (accountId, date, vendor, amount) => ({ recurring_id: 1, account_id: accountId, date, vendor, category: 'Bills', amount });
const SCHEDULED = [
  occurrence(6, '2026-11-09', 'Allina Health', -87.38),
  occurrence(6, '2026-11-30', 'ASPIRE', -75),
  occurrence(7, '2026-12-01', 'HLWW School District', 1700),
];

// Spending over the last 90 days (Aug 11 – Nov 8, 2026): Bills all in its series, so scheduled;
// Grocery ($90 in Checking) and Restaurants ($27 in Discover) averaged, $1.00 and $0.30 a day
const spend = (id, accountId, date, category, amount, recurringId = null) => ({
  id, account_id: accountId, date, vendor: `Vendor ${id}`, category,
  amount_cents: Math.round(amount * 100), recurring_id: recurringId, is_transfer: false,
});
const RECENT = [
  spend(101, 6, '2026-10-26', 'Bills', -87.38, 1),
  spend(102, 6, '2026-09-01', 'Grocery', -45),
  spend(103, 6, '2026-10-01', 'Grocery', -45),
  spend(104, 5, '2026-10-10', 'Restaurants', -27),
];

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
  getProjection.mockResolvedValue([]);
});
afterEach(() => jest.useRealTimers());

// Opens Insights → Accounts and waits for the balances
const openTab = async ({ accounts = ACCOUNTS, transactions = [], recurring = [], onError = jest.fn() } = {}) => {
  render(
    <CategoryColorProvider>
      <InsightsView transactions={transactions} accounts={accounts} recurring={recurring} onError={onError} />
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

describe('the forecast', () => {
  const forecastLine = () => tab().querySelector('.balance-forecast-line').textContent;

  test('it continues net position for 90 days by the scheduled items and the averaged spending, dashed and labelled', async () => {
    getProjection.mockResolvedValue(SCHEDULED);
    await openTab({ transactions: RECENT });
    await waitFor(() => expect(getProjection).toHaveBeenCalledWith(90));
    // $9,421.68 − $87.38 − $75.00 + $1,700.00 scheduled, − $117.00 averaged over the 90 days
    await waitFor(() => expect(forecastLine())
      .toBe('Forecast for Feb 6, 2027: $10,842.30, from scheduled items and your average spending over the last 90 days'));
    expect(tab().querySelector('.balance-forecast .recharts-line-curve')).not.toBeNull();
    expect(within(tab()).getByText('Forecast: scheduled items and average spending over the last 90 days')).toBeInTheDocument();
    expect(summary()).toEqual(['$9,421.68', 'Up $9,913.97 since Nov 8, 2025']);     // the history is unchanged
  });

  test("an account's forecast counts only its own items and spending, and the table lists each forecast day", async () => {
    getProjection.mockResolvedValue(SCHEDULED);
    await openTab({ transactions: RECENT });
    await pick("Owen's Checking");
    await pick('3M');
    await waitFor(() => expect(forecastLine())
      .toBe('Forecast for Feb 6, 2027: $7,021.75, from scheduled items and your average spending over the last 90 days'));
    const rows = (await tableRows()).slice(1);
    expect(rows).toHaveLength(91);
    expect(rows.slice(0, 3)).toEqual([
      ['Oct 31, 2026', '$7,274.13', '+$2,274.13'],
      ['Nov 9, 2026 (forecast)', '$7,185.75', '-$88.38'],
      ['Nov 10, 2026 (forecast)', '$7,184.75', '-$1.00'],
    ]);
    expect(rows[22]).toEqual(['Nov 30, 2026 (forecast)', '$7,089.75', '-$76.00']);
    expect(rows[90]).toEqual(['Feb 6, 2027 (forecast)', '$7,021.75', '-$1.00']);
  });

  test('a series charge in an averaged category gives way to the average', async () => {
    getProjection.mockResolvedValue(SCHEDULED);
    // Bills now half in its series: Allina's and ASPIRE's charges leave the forecast, and Bills'
    // $174.76 joins the averages
    await openTab({ transactions: [...RECENT, spend(105, 6, '2026-10-27', 'Bills', -87.38)] });
    await pick("Owen's Checking");
    // $7,274.13 − $90.00 Grocery − $174.76 Bills
    await waitFor(() => expect(forecastLine())
      .toBe('Forecast for Feb 6, 2027: $7,009.37, from scheduled items and your average spending over the last 90 days'));
  });

  test("an ended series' charges are left out of its category's average", async () => {
    getProjection.mockResolvedValue(SCHEDULED);
    // Medical: $120 from series 7, finished after 4 payments, and $30 outside it: only the $30 is averaged
    await openTab({
      transactions: [...RECENT, spend(106, 6, '2026-09-20', 'Medical', -120, 7), spend(107, 6, '2026-09-21', 'Medical', -30)],
      recurring: [{ id: 7, number: 4, idx: 5 }],
    });
    await pick("Owen's Checking");
    // $7,274.13 − $87.38 − $75.00 scheduled − $90.00 Grocery − $30.00 Medical
    await waitFor(() => expect(forecastLine())
      .toBe('Forecast for Feb 6, 2027: $6,991.75, from scheduled items and your average spending over the last 90 days'));
  });

  test('a failed projection is reported, and the history shows without a forecast', async () => {
    getProjection.mockRejectedValue(new Error('Could not load the projection'));
    const onError = jest.fn();
    await openTab({ onError });
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Could not load the projection'));
    expect(tab().querySelector('.balance-forecast-line')).toBeNull();
    expect(summary()).toEqual(['$9,421.68', 'Up $9,913.97 since Nov 8, 2025']);
  });
});

test("a forecast day's tooltip lists the items scheduled that day", () => {
  render(<BalanceTooltip active payload={[{ payload: { date: '2026-12-01', cents: 1095930, kind: 'forecast', items: [SCHEDULED[2]], average: 0 } }]}
    transactions={[]} accountIds={[5, 6, 7]} />);
  expect([...screen.getByRole('tooltip').querySelectorAll('strong, .tip-amount, li')].map(e => e.textContent)).toEqual([
    'Dec 1, 2026, forecast', '$10,959.30', 'HLWW School District+$1,700.00',
  ]);
});

test("a forecast day's tooltip adds that day's share of the average spending", () => {
  render(<BalanceTooltip active payload={[{ payload: { date: '2026-11-09', cents: 718575, kind: 'forecast', items: [SCHEDULED[0]], average: 100 } }]}
    transactions={[]} accountIds={[6]} />);
  expect([...screen.getByRole('tooltip').querySelectorAll('strong, .tip-amount, li')].map(e => e.textContent)).toEqual([
    'Nov 9, 2026, forecast', '$7,185.75', 'Allina Health-$87.38', 'Average spending over the last 90 days-$1.00',
  ]);
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
