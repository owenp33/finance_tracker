import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BudgetingView from '../components/BudgetingView';
import { CategoryColorProvider } from '../CategoryColorContext';
import { getBudgetProgress, getBudgets } from '../api/budgets';

jest.mock('../api/budgets');

// A row of GET /api/budgets/progress, as the backend sends it
const progressRow = (id, category, allocated, spent, carriedOver = 0) => {
  const cents = (dollars) => Math.round(dollars * 100);
  const remaining = cents(allocated) + cents(carriedOver) - cents(spent);
  return {
    id, category, period: '2026-10', rollover: true,
    allocated, allocated_cents: cents(allocated), carried_over: carriedOver, carried_over_cents: cents(carriedOver),
    spent, spent_cents: cents(spent), remaining: remaining / 100, remaining_cents: remaining, over_budget: remaining < 0,
  };
};

const OCTOBER = [
  progressRow(1, 'Fun', 50, 69.40),
  progressRow(2, 'Gasoline', 200, 96),
  progressRow(3, 'Groceries', 400, 150),
  progressRow(4, 'Restaurants', 100, 76, 20),
];
const SEPTEMBER = [progressRow(5, 'Groceries', 400, 380)];

let user;

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 15, 12));   // Oct 15, 2026: 15/31 of the month
  user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  getBudgets.mockResolvedValue([]);
  getBudgetProgress.mockImplementation(async (period) => (period === '2026-09' ? SEPTEMBER : OCTOBER));
});

afterEach(() => jest.useRealTimers());

const renderView = async () => {
  render(
    <CategoryColorProvider>
      <BudgetingView transactions={[]} onBudgetChange={jest.fn()} />
    </CategoryColorProvider>
  );
  await screen.findByRole('img', { name: /^Groceries:/ });
};

const bar = (category) => screen.getByRole('img', { name: new RegExp(`^${category}:`) });
const pace = (category) => bar(category).closest('.budget-pace');
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
    ['Expected by today', '$58.06'],
    ['Projected month end', '$157.07'],
  ]);
  expect(bar('Restaurants')).toHaveAccessibleDescription(/Expected by today/);

  await user.unhover(bar('Restaurants'));
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});

test('focusing a bar shows the numbers too, and Escape hides them', async () => {
  await renderView();
  act(() => bar('Groceries').focus());
  expect(details(screen.getByRole('tooltip'))).toEqual([
    ['Spent', '$150.00'], ['Budget', '$400.00'], ['Expected by today', '$193.55'], ['Projected month end', '$310.00'],
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
    ['Category', 'Spent', 'Budget', 'Used', 'Expected by today', 'Projected month end', 'Status'],
    ['Fun', '$69.40', '$50.00', '139%', '$24.19', '$143.43', 'Over by $19.40'],
    ['Gasoline', '$96.00', '$200.00', '48%', '$96.77', '$198.40', 'On pace'],
    ['Groceries', '$150.00', '$400.00', '38%', '$193.55', '$310.00', '$44 under'],
    ['Restaurants', '$76.00', '$120.00', '63%', '$58.06', '$157.07', '$18 ahead'],
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
