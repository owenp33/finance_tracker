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
  is_reimbursement: false, over_budget: false, on_loan_account: false, loan_payment_id: null, ...overrides,
});

test("select all leaves out loan entries, which follow their payments and can't be deleted", async () => {
  const onDeleteMany = jest.fn().mockResolvedValue();
  render(
    <CategoryColorProvider>
      <TransactionsView
        transactions={[tx(1), tx(2, { amount: 75, amount_cents: 7500, account_id: 5, account_name: 'ASPIRE loan',
                                      on_loan_account: true, loan_payment_id: 1 })]}
        recurringTransactions={[]}
        accounts={[{ id: 1, account_name: 'Checking', kind: 'bank' }, { id: 5, account_name: 'ASPIRE loan', kind: 'loan' }]}
        onDeleteMany={onDeleteMany}
      />
    </CategoryColorProvider>
  );
  await user.click(screen.getByLabelText('Select all 1'));
  await user.click(screen.getByRole('button', { name: 'Delete 1 selected' }));
  expect(onDeleteMany).toHaveBeenCalledWith([1]);
});
