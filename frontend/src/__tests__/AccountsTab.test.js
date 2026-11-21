import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InsightsView from '../components/InsightsView';
import { BalanceTooltip } from '../components/insights/charts/BalanceChart';
import { CategoryColorProvider } from '../CategoryColorContext';
import { getBalances } from '../api/balances';
import { getProjection } from '../api/recurring';
import { getGoals } from '../api/goals';

jest.mock('../api/balances');
jest.mock('../api/recurring');
jest.mock('../api/goals');

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
  getGoals.mockResolvedValue([]);
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
      .toBe('Forecast for Feb 6, 2027: $10,842.30'));
    expect(tab().querySelector('.balance-forecast .recharts-line-curve')).not.toBeNull();
    expect(within(tab()).getByText('Forecast: scheduled items, average spending (over the last 90 days), and any interest')).toBeInTheDocument();
    expect(summary()).toEqual(['$9,421.68', 'Up $9,913.97 since Nov 8, 2025']);     // the history is unchanged
  });

  test("an account's forecast counts only its own items and spending, and the table lists each forecast day", async () => {
    getProjection.mockResolvedValue(SCHEDULED);
    await openTab({ transactions: RECENT });
    await pick("Owen's Checking");
    await pick('3M');
    await waitFor(() => expect(forecastLine())
      .toBe('Forecast for Feb 6, 2027: $7,021.75'));
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
      .toBe('Forecast for Feb 6, 2027: $7,009.37'));
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
      .toBe('Forecast for Feb 6, 2027: $6,991.75'));
  });

  test('a failed projection is reported, and the history shows without a forecast', async () => {
    getProjection.mockRejectedValue(new Error('Could not load the projection'));
    const onError = jest.fn();
    await openTab({ onError });
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Could not load the projection'));
    expect(tab().querySelector('.balance-forecast-line')).toBeNull();
    expect(within(tab()).queryByText('What the forecast assumes')).not.toBeInTheDocument();
    expect(summary()).toEqual(['$9,421.68', 'Up $9,913.97 since Nov 8, 2025']);
  });

  test('"What the forecast assumes" gives each category\'s basis, the scheduled income and a total that matches the forecast', async () => {
    getProjection.mockResolvedValue(SCHEDULED);
    await openTab({ transactions: RECENT });
    await waitFor(() => expect(forecastLine()).toMatch(/\$10,842\.30/));
    await user.click(within(tab()).getByText('What the forecast assumes'));
    expect(within(tab()).getByText('Categories at least 90% recurring over the last 90 days use their scheduled charges; others, their 90-day average.')).toBeInTheDocument();
    const assumptions = () => cells(screen.getByRole('table', { name: /^What the forecast assumes/ }));
    // $9,421.68 + $1,420.62 = $10,842.30, the forecast line's
    expect(assumptions()).toEqual([
      ['Category', 'Spent over the last 90 days', 'Reimbursed', 'Share in a series, all accounts', 'Forecast from', 'Next 90 days'],
      ['Scheduled income', '—', '—', '—', '1 payment from 1 series', '+$1,700.00'],
      ['Bills', '$87.38', '—', '100%', 'Recurring, 2 due', '-$162.38'],
      ['Grocery', '$90.00', '—', '0%', '$1.00 a day (average)', '-$90.00'],
      ['Restaurants', '$27.00', '—', '0%', '$0.30 a day (average)', '-$27.00'],
      ['Total', '$204.38', '—', '', '', '+$1,420.62'],
    ]);
    await pick("Owen's Checking");
    expect(screen.getByRole('table', { name: "What the forecast assumes, Owen's Checking" })).toBeInTheDocument();
    expect(assumptions().slice(1)).toEqual([
      ['Bills', '$87.38', '—', '100%', 'Recurring, 2 due', '-$162.38'],
      ['Grocery', '$90.00', '—', '0%', '$1.00 a day (average)', '-$90.00'],
      ['Total', '$177.38', '—', '', '', '-$252.38'],
    ]);
  });

  test('a reimbursement that pays back the charge outside the series puts the category back on its schedule', async () => {
    getProjection.mockResolvedValue(SCHEDULED);
    // Bills: $87.38 in its series, $87.38 outside it, and $87.38 paid back
    const paidBack = { ...spend(108, 6, '2026-10-28', 'Bills', 87.38), is_reimbursement: true };
    await openTab({ transactions: [...RECENT, spend(105, 6, '2026-10-27', 'Bills', -87.38), paidBack] });
    await pick("Owen's Checking");
    // As without the extra charge: Allina's and ASPIRE's charges are back, and Bills isn't averaged
    await waitFor(() => expect(forecastLine())
      .toBe('Forecast for Feb 6, 2027: $7,021.75'));
    await user.click(within(tab()).getByText('What the forecast assumes'));
    expect(cells(screen.getByRole('table', { name: /^What the forecast assumes/ }))[1])
      .toEqual(['Bills', '$174.76', '$87.38', '100%', 'Recurring, 2 due', '-$162.38']);
  });

  test('a series with no spending over the last 90 days is named as such, and so is one in an averaged category', async () => {
    getProjection.mockResolvedValue([
      { recurring_id: 30, account_id: 5, date: '2026-11-20', vendor: 'StreamCo', category: 'Streaming', amount: -15.99 },
      { recurring_id: 31, account_id: 5, date: '2026-11-21', vendor: 'Meal kit', category: 'Restaurants', amount: -60 },
    ]);
    await openTab({ transactions: RECENT });
    await pick("Owen's Discover");
    await user.click(within(tab()).getByText('What the forecast assumes'));
    await waitFor(() => expect(cells(screen.getByRole('table', { name: /^What the forecast assumes/ })).slice(1)).toEqual([
      ['Restaurants', '$27.00', '—', '0%', '$0.30 a day (average), plus 1 charge due from a series with no spending over the last 90 days', '-$87.00'],
      ['Streaming', '—', '—', '—', 'Recurring, 1 due (no spending over the last 90 days)', '-$15.99'],
      ['Total', '$27.00', '—', '', '', '-$102.99'],
    ]));
  });
});

describe("a loan's forecast", () => {
  // ASPIRE loan (account 9): $10,000 owed at 7.3% a year, charged monthly; ASPIRE (template 5, on
  // Checking) pays it down on Nov 30
  const LOAN = entry(9, 'ASPIRE loan', -1000000, []);
  const LOAN_ACCOUNT = { id: 9, account_id: 'aspire', account_name: 'ASPIRE loan', balance: -10000, kind: 'loan', apr: 7.3,
                         interest_frequency: 'monthly' };
  const ASPIRE = { recurring_id: 5, account_id: 6, date: '2026-11-30', vendor: 'ASPIRE', category: 'Loan', amount: -75 };
  const open = async () => {
    getBalances.mockResolvedValue([...BALANCES, LOAN]);
    getProjection.mockResolvedValue([ASPIRE]);
    await openTab({ accounts: [...ACCOUNTS, LOAN_ACCOUNT], recurring: [{ id: 5, loan_account_id: 9 }] });
    await pick('ASPIRE loan');
  };

  test('it gets its scheduled payments and interest on the 1st at its rate, and says so', async () => {
    await open();
    // Dec 1 $60.38, Jan 1 $60.74, Feb 1 $61.11, each a 12th of 7.3% of what was owed the day before
    await waitFor(() => expect(tab().querySelector('.balance-forecast-line').textContent)
      .toBe('Forecast for Feb 6, 2027: -$10,107.23'));
    expect((await tableRows()).slice(1)).toEqual([
      ['Nov 30, 2026 (forecast)', '-$9,925.00', '+$75.00'],
      ['Dec 1, 2026 (forecast)', '-$9,985.38', '-$60.38'],
      ['Jan 1, 2027 (forecast)', '-$10,046.12', '-$60.74'],
      ['Feb 1, 2027 (forecast)', '-$10,107.23', '-$61.11'],
    ]);
  });

  test('"What the forecast assumes" lists its payments and interest, and the total matches the forecast', async () => {
    await open();
    await user.click(within(tab()).getByText('What the forecast assumes'));
    const rows = await waitFor(() => cells(screen.getByRole('table', { name: 'What the forecast assumes, ASPIRE loan' })).slice(1));
    expect(rows).toEqual([
      ['ASPIRE loan: payments', '—', '—', '—', '1 payment from its paying series', '+$75.00'],
      ['ASPIRE loan: interest', '—', '—', '—', '7.30% a year, charged monthly', '-$182.23'],
      ['Total', '$0.00', '—', '', '', '-$107.23'],     // -$10,107.23, the forecast line's, less today's -$10,000.00
    ]);
  });
});

describe('goals on the chart', () => {
  // A GET /api/goals row
  const goalRow = (accountId, name, balanceCents, targetCents) => ({
    id: accountId, position: 1, account_id: accountId, account_name: name, account_kind: 'bank',
    balance_cents: balanceCents, target_cents: targetCents, remaining_cents: Math.max(targetCents - balanceCents, 0),
    monthly_cents: null, reached: balanceCents >= targetCents, active: balanceCents < targetCents,
  });
  const note = () => tab().querySelector('.balance-goal-note');

  test("an account's goal is a dashed line, and the note says when the forecast reaches it", async () => {
    getProjection.mockResolvedValue(SCHEDULED);
    getGoals.mockResolvedValue([goalRow(7, "Owen's Savings", 300000, 400000)]);
    await openTab();
    await pick("Owen's Savings");
    // $3,000.00 plus the $1,700.00 paycheck on Dec 1
    await waitFor(() => expect(note().textContent).toBe('Goal $4,000.00: reached Dec 1, 2026'));
    expect(tab().querySelector('.balance-goal-line')).not.toBeNull();
  });

  test("a goal the forecast doesn't reach in 90 days says so", async () => {
    getProjection.mockResolvedValue(SCHEDULED);
    getGoals.mockResolvedValue([goalRow(7, "Owen's Savings", 300000, 750000)]);
    await openTab();
    await pick("Owen's Savings");
    await waitFor(() => expect(note().textContent).toBe('Goal $7,500.00: not reached in 90 days'));
  });

  test('a goal already reached warns when the forecast dips under it', async () => {
    getProjection.mockResolvedValue(SCHEDULED);
    getGoals.mockResolvedValue([goalRow(6, "Owen's Checking", 727413, 720000)]);
    await openTab();
    await pick("Owen's Checking");
    // $7,274.13 less Allina's $87.38 on Nov 9
    await waitFor(() => expect(note().textContent).toBe('Goal $7,200.00: dips under Nov 9, 2026'));
    expect(note()).toHaveClass('warning');
  });

  test('a goal held through the forecast says so, and net position draws no goal', async () => {
    getProjection.mockResolvedValue(SCHEDULED);
    getGoals.mockResolvedValue([goalRow(6, "Owen's Checking", 727413, 500000)]);
    await openTab();
    expect(note()).toBeNull();                                   // net position: goals are per account
    expect(tab().querySelector('.balance-goal-line')).toBeNull();
    await pick("Owen's Checking");
    await waitFor(() => expect(note().textContent).toBe('Goal $5,000.00: holds through Feb 6, 2027'));
    expect(note()).not.toHaveClass('warning');
  });
});

test("a forecast day's tooltip lists the items scheduled that day", () => {
  render(<BalanceTooltip active payload={[{ payload: { date: '2026-12-01', cents: 1095930, kind: 'forecast', items: [SCHEDULED[2]], average: 0 } }]}
    transactions={[]} accountIds={[5, 6, 7]} />);
  expect([...screen.getByRole('tooltip').querySelectorAll('strong, .tip-amount, li')].map(e => e.textContent)).toEqual([
    'Dec 1, 2026, forecast', '$10,959.30', 'HLWW School District+$1,700.00',
  ]);
});

test("a forecast day's tooltip adds the interest charged or paid that day", () => {
  render(<BalanceTooltip active payload={[{ payload: { date: '2026-12-01', cents: -998538, kind: 'forecast', items: [], average: 0, interest: -6038 } }]}
    transactions={[]} accountIds={[9]} />);
  expect([...screen.getByRole('tooltip').querySelectorAll('strong, .tip-amount, li')].map(e => e.textContent)).toEqual([
    'Dec 1, 2026, forecast', '-$9,985.38', 'Interest-$60.38',
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
