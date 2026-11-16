import { monthlyNet } from '../components/insights/monthlyNet';

const tx = (date, amount, category, vendor, flags) => ({
  id: `${date}-${category}`, date, amount, amount_cents: Math.round(amount * 100), category, vendor,
  is_transfer: false, is_reimbursement: false, ...flags,
});
const spend = (date, category, dollars) => tx(date, -dollars, category, `${category} shop`);

// Jun–Oct 2026 full, Nov so far: net $500, -$600, $300, $900, nothing in October, -$200 so far
const NET_TRANSACTIONS = [
  ...['06', '07', '08', '09'].map(m => tx(`2026-${m}-01`, 2000, 'Paycheck', 'Employer')),
  spend('2026-06-15', 'Rent', 1500), spend('2026-07-15', 'Rent', 2600),
  spend('2026-08-15', 'Rent', 1700), spend('2026-09-15', 'Rent', 1100),
  spend('2026-11-03', 'Groceries', 200),
  tx('2026-09-20', -500, 'Transfer', 'To savings', { is_transfer: true }),
];

const MONTHS = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];

test("each month's money in, money out and net, transfers left out and empty months at zero", () => {
  expect(monthlyNet(NET_TRANSACTIONS, MONTHS, ['2026-11']).map(m => [m.month, m.income, m.expenses, m.net, m.partial])).toEqual([
    ['2026-06', 200000, 150000, 50000, false],
    ['2026-07', 200000, 260000, -60000, false],
    ['2026-08', 200000, 170000, 30000, false],
    ['2026-09', 200000, 110000, 90000, false],
    ['2026-10', 0, 0, 0, false],
    ['2026-11', 0, 20000, -20000, true],
  ]);
});

test('the 3-month average sits on the middle month of three full months in a row', () => {
  // Jun–Aug's on July, Jul–Sep's on August, Aug–Oct's on September; October's would take in
  // November, which is partial, and June has no month before it
  expect(monthlyNet(NET_TRANSACTIONS, MONTHS, ['2026-11']).map(m => m.average)).toEqual([
    null, 6667, 20000, 40000, null, null,
  ]);
  // A partial first month (a period starting mid-month) isn't in any average either
  expect(monthlyNet(NET_TRANSACTIONS, MONTHS, ['2026-06', '2026-11']).map(m => m.average)).toEqual([
    null, null, 20000, 40000, null, null,
  ]);
  // Nor is a partial month in the middle (this month, in a period that ends later): no average
  // reaches across it
  expect(monthlyNet(NET_TRANSACTIONS, MONTHS, ['2026-07', '2026-11']).map(m => m.average)).toEqual([
    null, null, null, 40000, null, null,
  ]);
});
