import { topVendors, vendorDetail } from '../components/insights/vendorSpending';

const tx = (date, amount, vendor, flags) => ({
  id: `${date}-${vendor}-${amount}`, date, amount, amount_cents: Math.round(amount * 100), vendor, category: 'Misc',
  is_transfer: false, is_reimbursement: false, recurring_id: null, ...flags,
});

const TRANSACTIONS = [
  tx('2026-09-02', -652.49, 'Millenium', { recurring_id: 10 }),
  tx('2026-10-02', -652.49, 'Millenium', { recurring_id: 10 }),
  tx('2026-09-10', -42.10, 'Cub Foods'),
  tx('2026-10-10', -57.90, 'Cub Foods'),
  tx('2026-11-05', -20, 'Cub Foods'),
  tx('2026-10-15', 30, 'Cub Foods', { is_reimbursement: true }),      // money in: not spending
  tx('2026-10-01', -75, 'ASPIRE', { recurring_id: 5 }),
  tx('2026-10-20', -60, 'ASPIRE'),                                   // an extra payment, not in the series
  tx('2026-10-05', -500, 'Savings', { is_transfer: true }),           // never counts
  tx('2026-10-06', 0, 'Nothing'),
  tx('2026-10-07', 2000, 'Employer'),
];

test('the vendors spent with most, largest first, with how many charges and their average', () => {
  expect(topVendors(TRANSACTIONS)).toEqual([
    { vendor: 'Millenium', total: 130498, count: 2, average: 65249 },
    { vendor: 'ASPIRE', total: 13500, count: 2, average: 6750 },
    { vendor: 'Cub Foods', total: 12000, count: 3, average: 4000 },
  ]);
});

test('leaving out recurring charges drops the charges in a series, not the vendor\'s others', () => {
  expect(topVendors(TRANSACTIONS, { leaveOutRecurring: true })).toEqual([
    { vendor: 'Cub Foods', total: 12000, count: 3, average: 4000 },
    { vendor: 'ASPIRE', total: 6000, count: 1, average: 6000 },
  ]);
});

test('only the top ten, ties by name', () => {
  const many = Array.from({ length: 12 }, (_, i) => tx('2026-10-01', -10, `Vendor ${String.fromCharCode(76 - i)}`));
  const top = topVendors(many);
  expect(top).toHaveLength(10);
  expect(top.map(v => v.vendor).slice(0, 3)).toEqual(['Vendor A', 'Vendor B', 'Vendor C']);
});

test("a vendor's detail: its charges newest first, its totals, and its spending per month with the full months' average", () => {
  const months = ['2026-09', '2026-10', '2026-11'];
  expect(vendorDetail(TRANSACTIONS, 'Cub Foods', months, ['2026-11'])).toMatchObject({
    total: 12000, count: 3, average: 4000,
    months: [
      { month: '2026-09', cents: 4210, partial: false },
      { month: '2026-10', cents: 5790, partial: false },
      { month: '2026-11', cents: 2000, partial: true },
    ],
    monthlyAverage: 5000,
  });
  expect(vendorDetail(TRANSACTIONS, 'Cub Foods', months, ['2026-11']).transactions.map(t => t.date))
    .toEqual(['2026-11-05', '2026-10-10', '2026-09-10']);
  expect(vendorDetail(TRANSACTIONS, 'ASPIRE', months, ['2026-11'], { leaveOutRecurring: true }).transactions.map(t => t.amount))
    .toEqual([-60]);
});
