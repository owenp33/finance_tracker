import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TransactionsView from '../components/TransactionsView';
import { CategoryColorProvider } from '../CategoryColorContext';

// The All tab opens on this month, so the clock is pinned (Nov 15, 2026, noon)
let user;
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 10, 15, 12));
  user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
});
afterEach(() => jest.useRealTimers());

const tx = (id, overrides) => ({
  id, date: '2026-11-05', vendor: 'ASPIRE', category: 'Loan', notes: '', amount: -75, amount_cents: -7500,
  account_id: 1, account_name: 'Checking', recurring_id: null, recurring_index: null, is_transfer: false,
  is_reimbursement: false, over_budget: false, on_loan_account: false, ...overrides,
});

test("select all takes every transaction shown, a loan account's own included", async () => {
  const onDeleteMany = jest.fn().mockResolvedValue();
  render(
    <CategoryColorProvider>
      <TransactionsView
        transactions={[tx(1), tx(2, { vendor: 'Interest', category: 'Interest', amount: -419.96, amount_cents: -41996,
                                      account_id: 5, account_name: 'ASPIRE loan', on_loan_account: true })]}
        recurringTransactions={[]}
        accounts={[{ id: 1, account_name: 'Checking', kind: 'bank' }, { id: 5, account_name: 'ASPIRE loan', kind: 'loan' }]}
        onDeleteMany={onDeleteMany}
      />
    </CategoryColorProvider>
  );
  await user.click(screen.getByLabelText('Select all 2'));
  await user.click(screen.getByRole('button', { name: 'Delete 2 selected' }));
  expect(onDeleteMany).toHaveBeenCalledWith(expect.arrayContaining([1, 2]));
});

// The bulk buttons wait, as one, while nothing is selected: a laptop keeps their room (hidden), a phone
// gives it to "Select all" (styles/transactions.css), so the label doesn't wrap
test('the bulk buttons are idle until something is selected', async () => {
  render(
    <CategoryColorProvider>
      <TransactionsView transactions={[tx(1), tx(2)]} recurringTransactions={[]}
                        accounts={[{ id: 1, account_name: 'Checking', kind: 'bank' }]} onDeleteMany={jest.fn()} />
    </CategoryColorProvider>
  );
  const bulkButtons = screen.getByRole('button', { name: /^Delete .* selected$/ }).parentElement;
  expect(bulkButtons).toHaveClass('bulk-actions', 'idle');
  await user.click(screen.getByLabelText('Select all 2'));
  expect(bulkButtons).not.toHaveClass('idle');
  expect(screen.getByRole('button', { name: 'Delete 2 selected' })).not.toHaveStyle({ visibility: 'hidden' });
});
