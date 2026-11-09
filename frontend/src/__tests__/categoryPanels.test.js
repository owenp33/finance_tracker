import { periodMonths, categoryPanels } from '../components/insights/categoryPanels';

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

describe('the months a period covers', () => {
  test('all time runs from the first transaction to this month, which is partial', () => {
    expect(periodMonths(TRANSACTIONS, '', '', '2026-11-08')).toEqual({
      months: ['2026-09', '2026-10', '2026-11'], partial: ['2026-11'],
    });
  });

  test('a period starting mid-month makes its first month partial too', () => {
    expect(periodMonths(TRANSACTIONS, '2026-08-08', '2026-11-08', '2026-11-08')).toEqual({
      months: ['2026-08', '2026-09', '2026-10', '2026-11'], partial: ['2026-08', '2026-11'],
    });
  });

  test('whole months in the past are all full', () => {
    expect(periodMonths(TRANSACTIONS, '2026-09-01', '2026-10-31', '2026-11-08')).toEqual({
      months: ['2026-09', '2026-10'], partial: [],
    });
  });

  test('no transactions and no dates: just this month', () => {
    expect(periodMonths([], '', '', '2026-11-08')).toEqual({ months: ['2026-11'], partial: ['2026-11'] });
  });
});

describe('the small multiples', () => {
  const panels = () => categoryPanels(TRANSACTIONS, ['2026-09', '2026-10', '2026-11'], ['2026-11']);

  test('the top 8 categories by spending, reimbursements taken off, then the rest as Other', () => {
    expect(panels().map(p => [p.category, p.total, p.count])).toEqual([
      ['Rent', 270000, 3], ['Groceries', 75000, 3], ['Gas', 24000, 2], ['Fun', 13000, 2],
      ['Dining', 10000, 2], ['Medical', 8700, 1], ['Subscriptions', 4000, 2], ['Shopping', 3000, 1],
      ['Other', 4000, 2],
    ]);
  });

  test('each panel has every month (partial ones marked), its average over the full months, and its last full month', () => {
    const [, groceries, , , , medical] = panels();
    expect(groceries).toMatchObject({
      months: [
        { month: '2026-09', cents: 30000, partial: false },
        { month: '2026-10', cents: 35000, partial: false },
        { month: '2026-11', cents: 10000, partial: true },
      ],
      average: 32500,
      last: { month: '2026-10', cents: 35000 },
    });
    expect(medical.months.map(m => m.cents)).toEqual([8700, 0, 0]);
    expect(medical.average).toBe(4350);
  });

  test('Other adds up the rest month by month, and names them', () => {
    expect(panels()[8]).toMatchObject({
      category: 'Other', others: ['Gifts', 'Pets'], months: [{ cents: 1500 }, { cents: 2500 }, { cents: 0 }],
    });
  });

  test('without a full month there is no average and no last full month', () => {
    const [rent] = categoryPanels(TRANSACTIONS, ['2026-11'], ['2026-11']);
    expect([rent.average, rent.last]).toEqual([null, null]);
  });

  test('a category its reimbursements cancel out, or no spending at all, makes no panel', () => {
    const refunded = [spend('2026-10-01', 'Gifts', 25), tx('2026-10-02', 25, 'Gifts', 'Refund', { is_reimbursement: true })];
    expect(categoryPanels(refunded, ['2026-10'], [])).toEqual([]);
    expect(categoryPanels([], ['2026-10'], [])).toEqual([]);
  });
});
