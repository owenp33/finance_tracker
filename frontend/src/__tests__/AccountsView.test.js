import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccountsView from '../components/AccountsView';
import TransactionsView from '../components/TransactionsView';
import { CategoryColorProvider } from '../CategoryColorContext';

const account = (overrides) => ({
  id: 1, account_id: 'checking-1234', account_name: 'Checking', balance: 100, opening_balance: 0,
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
  expect(within(item).getByText(/Created by an import/)).toHaveTextContent(/starting balance/);

  await userEvent.click(within(item).getByRole('button', { name: 'Looks good' }));
  expect(onEditAccount).toHaveBeenCalledWith(7, { needs_attention: false });
});

test('a reviewed account shows no flag', () => {
  renderAccounts([account()]);
  const item = accountItem('Checking');
  expect(within(item).queryByText('Needs attention')).not.toBeInTheDocument();
  expect(within(item).queryByRole('button', { name: 'Looks good' })).not.toBeInTheDocument();
});

const startEditing = async (name) => {
  await userEvent.click(within(accountItem(name)).getByRole('button', { name: 'Edit' }));
  return screen.getByLabelText('Starting balance');
};

test('the edit form saves the starting balance with the name and id', async () => {
  const onEditAccount = renderAccounts([account({ opening_balance: 0 })], jest.fn().mockResolvedValue(true));
  const field = await startEditing('Checking');
  expect(field).toHaveValue(0);

  await userEvent.clear(field);
  await userEvent.type(field, '1500.25');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));

  expect(onEditAccount).toHaveBeenCalledWith(1, {
    account_id: 'checking-1234', account_name: 'Checking', opening_balance: 1500.25,
  });
  expect(screen.queryByLabelText('Starting balance')).not.toBeInTheDocument();
});

test('the edit form stays open when the save is rejected', async () => {
  renderAccounts([account()], jest.fn().mockResolvedValue(false));
  await startEditing('Checking');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByLabelText('Starting balance')).toBeInTheDocument();
});

test('saving needs a starting balance', async () => {
  renderAccounts([account()]);
  await userEvent.clear(await startEditing('Checking'));
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
});

test('the row shows the balance, and the starting balance when there is one', () => {
  renderAccounts([
    account({ id: 1, account_name: 'Discover', balance: -1630.14, opening_balance: -815.07 }),
    account({ id: 2, account_name: 'Savings', balance: 7512.51, opening_balance: 0 }),
  ]);
  const discover = accountItem('Discover');
  expect(within(discover).getByText('-$1,630.14')).toHaveClass('account-balance');
  expect(within(discover).getByText('Starting balance -$815.07')).toBeInTheDocument();

  const savings = accountItem('Savings');
  expect(within(savings).getByText('$7,512.51')).toHaveClass('account-balance');
  expect(within(savings).queryByText(/Starting balance/)).not.toBeInTheDocument();
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

test('the transactions page has no Flagged tab (over budget shows as a chip instead)', () => {
  render(
    <CategoryColorProvider>
      <TransactionsView transactions={[]} recurringTransactions={[]} accounts={[]} />
    </CategoryColorProvider>
  );
  expect(screen.queryByRole('button', { name: /^Flagged/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Accounts/ })).toBeInTheDocument();
});
