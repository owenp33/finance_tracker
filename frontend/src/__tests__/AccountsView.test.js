import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccountsView from '../components/AccountsView';
import TransactionsView from '../components/TransactionsView';
import { CategoryColorProvider } from '../CategoryColorContext';

const account = (overrides) => ({
  id: 1, account_id: 'checking-1234', account_name: 'Checking', balance: 100, opening_balance: 0,
  transaction_count: 0, recurring_count: 0, needs_attention: false, kind: 'bank', apr: null, ...overrides,
});

const renderAccounts = (accounts, onEditAccount = jest.fn(), { onCreateAccount = jest.fn(), onLoanStatement = jest.fn() } = {}) => {
  render(
    <AccountsView
      transactions={[]} accounts={accounts}
      onEdit={jest.fn()} onDelete={jest.fn()} onPairTransfer={jest.fn()} onDeleteTransferBulk={jest.fn()}
      onCreateAccount={onCreateAccount} onEditAccount={onEditAccount} onDeleteAccount={jest.fn()}
      onLoanStatement={onLoanStatement}
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
    account_id: 'checking-1234', account_name: 'Checking', kind: 'bank', opening_balance: 1500.25,
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

const currentField = () => screen.getByLabelText('Current balance');

test('the starting and current balances are linked by what the transactions add up to', async () => {
  // $100.00 now from a $0.00 start, so the transactions add up to $100.00
  renderAccounts([account({ balance: 100, opening_balance: 0 })]);
  const starting = await startEditing('Checking');
  expect(currentField()).toHaveValue(100);
  expect(screen.getByText(/^The transactions here add up to \+\$100\.00/)).toBeInTheDocument();

  await userEvent.clear(starting);
  await userEvent.type(starting, '1500.25');
  expect(currentField()).toHaveValue(1600.25);

  await userEvent.clear(currentField());
  await userEvent.type(currentField(), '50');
  expect(starting).toHaveValue(-50);
});

test('saving after typing the current balance sends it, for the server to work out the starting balance', async () => {
  const onEditAccount = renderAccounts([account({ balance: 100, opening_balance: 0 })], jest.fn().mockResolvedValue(true));
  await startEditing('Checking');
  await userEvent.clear(currentField());
  await userEvent.type(currentField(), '2000');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onEditAccount).toHaveBeenCalledWith(1, { account_id: 'checking-1234', account_name: 'Checking', kind: 'bank', balance: 2000 });
});

test('saving needs the balance typed in last', async () => {
  renderAccounts([account()]);
  await startEditing('Checking');
  await userEvent.clear(currentField());
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

describe('loan accounts', () => {
  test('a new account can be a loan, with its APR', async () => {
    const onCreateAccount = jest.fn().mockResolvedValue({ id: 9 });
    renderAccounts([], jest.fn(), { onCreateAccount });
    await userEvent.click(screen.getByRole('button', { name: '+ Add Account' }));
    await userEvent.type(screen.getByLabelText(/^Account ID/), 'aspire-1');
    await userEvent.type(screen.getByLabelText('Display Name'), 'ASPIRE loan');
    expect(screen.queryByLabelText('APR (%)')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'Loan');
    await userEvent.type(screen.getByLabelText('APR (%)'), '6.8');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onCreateAccount).toHaveBeenCalledWith({ account_id: 'aspire-1', account_name: 'ASPIRE loan', kind: 'loan', apr: 6.8 });
  });

  test("a new bank account sends no APR, and a loan's APR can wait", async () => {
    const onCreateAccount = jest.fn().mockResolvedValue({ id: 9 });
    renderAccounts([], jest.fn(), { onCreateAccount });
    await userEvent.click(screen.getByRole('button', { name: '+ Add Account' }));
    await userEvent.type(screen.getByLabelText(/^Account ID/), 'checking-9');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onCreateAccount).toHaveBeenLastCalledWith({ account_id: 'checking-9', account_name: 'checking-9', kind: 'bank' });

    await userEvent.click(screen.getByRole('button', { name: '+ Add Account' }));
    await userEvent.type(screen.getByLabelText(/^Account ID/), 'aspire-1');
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'Loan');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onCreateAccount).toHaveBeenLastCalledWith({ account_id: 'aspire-1', account_name: 'aspire-1', kind: 'loan', apr: null });
  });

  test('editing makes an account a loan with an APR', async () => {
    const onEditAccount = renderAccounts([account()], jest.fn().mockResolvedValue(true));
    await startEditing('Checking');
    expect(screen.getByLabelText('Type')).toHaveValue('bank');
    expect(screen.queryByLabelText('APR (%)')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'Loan');
    await userEvent.type(screen.getByLabelText('APR (%)'), '5.25');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEditAccount).toHaveBeenCalledWith(1, {
      account_id: 'checking-1234', account_name: 'Checking', kind: 'loan', apr: 5.25, opening_balance: 0,
    });
  });

  test("a loan's edit form starts from its APR, and a blank APR clears it", async () => {
    const onEditAccount = renderAccounts([account({ account_name: 'ASPIRE loan', kind: 'loan', apr: 6.8 })],
      jest.fn().mockResolvedValue(true));
    await startEditing('ASPIRE loan');
    expect(screen.getByLabelText('Type')).toHaveValue('loan');
    expect(screen.getByLabelText('APR (%)')).toHaveValue(6.8);
    await userEvent.clear(screen.getByLabelText('APR (%)'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEditAccount).toHaveBeenCalledWith(1, expect.objectContaining({ kind: 'loan', apr: null }));
  });

  test('a loan shows a badge and its APR, and only a loan offers Update from statement', () => {
    renderAccounts([
      account({ id: 5, account_name: 'ASPIRE loan', kind: 'loan', apr: 6.8, balance: -19850 }),
      account({ id: 6, account_name: 'MOHELA loan', kind: 'loan', apr: null }),
      account({ id: 2, account_name: 'Savings' }),
    ]);
    const aspire = accountItem('ASPIRE loan');
    expect(within(aspire).getByText('Loan')).toHaveClass('loan-badge');
    expect(within(aspire).getByText('APR 6.80%')).toBeInTheDocument();
    expect(within(aspire).getByRole('button', { name: 'Update from statement' })).toBeInTheDocument();
    expect(within(accountItem('MOHELA loan')).queryByText(/^APR/)).not.toBeInTheDocument();
    const savings = accountItem('Savings');
    expect(within(savings).queryByText('Loan')).not.toBeInTheDocument();
    expect(within(savings).queryByRole('button', { name: 'Update from statement' })).not.toBeInTheDocument();
  });

  const fillStatement = async (owed) => {
    await userEvent.click(screen.getByRole('button', { name: 'Update from statement' }));
    expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Statement date'), { target: { value: '2026-02-28' } });
    await userEvent.type(screen.getByLabelText('Balance owed'), owed);
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
  };

  test('a statement sends the balance owed as money owed, and says what it booked', async () => {
    const onLoanStatement = jest.fn().mockResolvedValue({ adjustment: { date: '2026-02-28', amount_cents: -5000 } });
    renderAccounts([account({ id: 5, account_name: 'ASPIRE loan', kind: 'loan', balance: -19850 })], jest.fn(), { onLoanStatement });
    await fillStatement('19900');
    expect(onLoanStatement).toHaveBeenCalledWith(5, { date: '2026-02-28', balance: -19900 });
    expect(screen.queryByLabelText('Balance owed')).not.toBeInTheDocument();
    expect(within(accountItem('ASPIRE loan')).getByText('Booked a statement adjustment of -$50.00 on Feb 28, 2026.'))
      .toHaveClass('account-statement-result');
  });

  test('a statement that matches books nothing, and says so', async () => {
    const onLoanStatement = jest.fn().mockResolvedValue({ adjustment: null });
    renderAccounts([account({ id: 5, account_name: 'ASPIRE loan', kind: 'loan', balance: -19850 })], jest.fn(), { onLoanStatement });
    await fillStatement('19850');
    expect(screen.getByText('The statement matches the balance here, so nothing was booked.')).toBeInTheDocument();
  });

  test('the statement form stays open when the update fails', async () => {
    const onLoanStatement = jest.fn().mockResolvedValue(null);
    renderAccounts([account({ id: 5, account_name: 'ASPIRE loan', kind: 'loan' })], jest.fn(), { onLoanStatement });
    await fillStatement('19900');
    expect(screen.getByLabelText('Balance owed')).toHaveValue(19900);
  });
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
