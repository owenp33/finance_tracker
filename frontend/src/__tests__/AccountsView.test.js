import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccountsView from '../components/AccountsView';
import TransactionsView from '../components/TransactionsView';
import { CategoryColorProvider } from '../CategoryColorContext';

const account = (overrides) => ({
  id: 1, account_id: 'checking-1234', account_name: 'Checking', balance: 100,
  transaction_count: 0, recurring_count: 0, needs_attention: false, ...overrides,
});

const renderAccounts = (accounts, onEditAccount = jest.fn()) => {
  render(
    <AccountsView
      transactions={[]} accounts={accounts}
      onEdit={jest.fn()} onDelete={jest.fn()} onPairTransfer={jest.fn()} onDeleteTransferBulk={jest.fn()}
      onCreateAccount={jest.fn()} onEditAccount={onEditAccount} onDeleteAccount={jest.fn()}
    />
  );
  return onEditAccount;
};

// Imported accounts show the same text as name and id, so take the first match (the name)
const accountItem = (name) => screen.getAllByText(name)[0].closest('.account-item');

test('an account created by an import is flagged until it is marked as reviewed', async () => {
  const onEditAccount = renderAccounts([
    account({ id: 7, account_id: 'AMEX GOLD', account_name: 'AMEX GOLD', needs_attention: true }),
  ]);

  const item = accountItem('AMEX GOLD');
  expect(within(item).getByText('Needs attention')).toHaveClass('needs-attention-badge');
  expect(within(item).getByText(/Created by an import/)).toBeInTheDocument();

  await userEvent.click(within(item).getByRole('button', { name: 'Looks good' }));
  expect(onEditAccount).toHaveBeenCalledWith(7, { needs_attention: false });
});

test('a reviewed account shows no flag', () => {
  renderAccounts([account()]);
  const item = accountItem('Checking');
  expect(within(item).queryByText('Needs attention')).not.toBeInTheDocument();
  expect(within(item).queryByRole('button', { name: 'Looks good' })).not.toBeInTheDocument();
});

test('the Accounts tab counts accounts that need attention', () => {
  render(
    <CategoryColorProvider>
      <TransactionsView
        transactions={[]} recurringTransactions={[]}
        accounts={[account({ id: 1, needs_attention: true }), account({ id: 2, account_name: 'Savings', needs_attention: true }),
                   account({ id: 3, account_name: 'Card' })]}
      />
    </CategoryColorProvider>
  );
  const tab = screen.getByRole('button', { name: /^Accounts/ });
  expect(within(tab).getByText('2')).toHaveClass('attention-badge');
});
