import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccountsView from '../components/AccountsView';
import TransactionsView from '../components/TransactionsView';
import { CategoryColorProvider } from '../CategoryColorContext';
import { getGoals } from '../api/goals';

jest.mock('../api/goals');
// Goals load after the first render; tests not about them leave the load pending, so no update
// arrives after a test ends. The goal tests below give their own rows.
beforeEach(() => getGoals.mockReturnValue(new Promise(() => {})));

const account = (overrides) => ({
  id: 1, account_id: 'checking-1234', account_name: 'Checking', balance: 100, opening_balance: 0,
  transaction_count: 0, recurring_count: 0, needs_attention: false, kind: 'bank', apr: null, ...overrides,
});

const renderAccounts = (accounts, onEditAccount = jest.fn(),
                        { onCreateAccount = jest.fn(), transactions = [], onDeleteTransferBulk = jest.fn(),
                          onEdit = jest.fn(), onPairTransfer = jest.fn() } = {}) => {
  render(
    <AccountsView
      transactions={transactions} accounts={accounts}
      onEdit={onEdit} onDelete={jest.fn()} onPairTransfer={onPairTransfer} onDeleteTransferBulk={onDeleteTransferBulk}
      onCreateAccount={onCreateAccount} onEditAccount={onEditAccount} onDeleteAccount={jest.fn()}
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
    account_id: 'checking-1234', account_name: 'Checking', kind: 'bank', apr: null, interest_frequency: null,
    opening_balance: 1500.25,
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
  expect(onEditAccount).toHaveBeenCalledWith(1, {
    account_id: 'checking-1234', account_name: 'Checking', kind: 'bank', apr: null, interest_frequency: null, balance: 2000,
  });
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
  const rate = () => screen.getByLabelText('APR (% a year)');
  const howOften = () => screen.queryByLabelText('How often');

  test('a new account can be a loan, with its yearly rate charged monthly by default', async () => {
    const onCreateAccount = jest.fn().mockResolvedValue({ id: 9 });
    renderAccounts([], jest.fn(), { onCreateAccount });
    await userEvent.click(screen.getByRole('button', { name: '+ Add Account' }));
    await userEvent.type(screen.getByLabelText(/^Account ID/), 'aspire-1');
    await userEvent.type(screen.getByLabelText('Display Name'), 'ASPIRE loan');
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'Loan');
    expect(howOften()).not.toBeInTheDocument();                     // no rate yet
    await userEvent.type(rate(), '6.8');
    expect(howOften()).toHaveValue('monthly');
    expect(screen.getByText(/Charged on what's owed/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onCreateAccount).toHaveBeenCalledWith({
      account_id: 'aspire-1', account_name: 'ASPIRE loan', kind: 'loan', apr: 6.8, interest_frequency: 'monthly',
    });
  });

  test('a savings account can earn interest, paid yearly', async () => {
    const onCreateAccount = jest.fn().mockResolvedValue({ id: 9 });
    renderAccounts([], jest.fn(), { onCreateAccount });
    await userEvent.click(screen.getByRole('button', { name: '+ Add Account' }));
    await userEvent.type(screen.getByLabelText(/^Account ID/), 'savings-1');
    await userEvent.type(rate(), '0.5');
    expect(screen.getByText(/Paid on a positive balance/)).toBeInTheDocument();
    await userEvent.selectOptions(howOften(), 'Yearly');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onCreateAccount).toHaveBeenCalledWith({
      account_id: 'savings-1', account_name: 'savings-1', kind: 'bank', apr: 0.5, interest_frequency: 'yearly',
    });
  });

  test('an account without a rate sends none', async () => {
    const onCreateAccount = jest.fn().mockResolvedValue({ id: 9 });
    renderAccounts([], jest.fn(), { onCreateAccount });
    await userEvent.click(screen.getByRole('button', { name: '+ Add Account' }));
    await userEvent.type(screen.getByLabelText(/^Account ID/), 'checking-9');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onCreateAccount).toHaveBeenCalledWith({
      account_id: 'checking-9', account_name: 'checking-9', kind: 'bank', apr: null, interest_frequency: null,
    });
  });

  test('editing makes an account a loan with a rate and how often it hits', async () => {
    const onEditAccount = renderAccounts([account()], jest.fn().mockResolvedValue(true));
    await startEditing('Checking');
    expect(screen.getByLabelText('Type')).toHaveValue('bank');
    expect(rate()).toHaveValue(null);
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'Loan');
    await userEvent.type(rate(), '5.25');
    await userEvent.selectOptions(howOften(), 'Quarterly');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEditAccount).toHaveBeenCalledWith(1, {
      account_id: 'checking-1234', account_name: 'Checking', kind: 'loan', apr: 5.25, interest_frequency: 'quarterly',
      opening_balance: 0,
    });
  });

  test("an account's edit form starts from its rate and frequency, and a blank rate clears both", async () => {
    const onEditAccount = renderAccounts([account({ account_name: 'Savings', apr: 0.5, interest_frequency: 'yearly' })],
      jest.fn().mockResolvedValue(true));
    await startEditing('Savings');
    expect(rate()).toHaveValue(0.5);
    expect(howOften()).toHaveValue('yearly');
    await userEvent.clear(rate());
    expect(howOften()).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEditAccount).toHaveBeenCalledWith(1, expect.objectContaining({ kind: 'bank', apr: null, interest_frequency: null }));
  });

  test('a row shows its rate and how often, and a loan its badge; a balance is set by editing, not by a statement', () => {
    renderAccounts([
      account({ id: 5, account_name: 'ASPIRE loan', kind: 'loan', apr: 6.8, interest_frequency: 'monthly', balance: -19850 }),
      account({ id: 6, account_name: 'MOHELA loan', kind: 'loan', apr: null }),
      account({ id: 2, account_name: 'Savings', apr: 0.5, interest_frequency: 'yearly' }),
    ]);
    const aspire = accountItem('ASPIRE loan');
    expect(within(aspire).getByText('Loan')).toHaveClass('loan-badge');
    expect(within(aspire).getByText('6.80% a year, monthly')).toHaveClass('account-apr');
    expect(within(aspire).queryByRole('button', { name: 'Update from statement' })).not.toBeInTheDocument();
    expect(within(accountItem('MOHELA loan')).queryByText(/a year/)).not.toBeInTheDocument();
    const savings = accountItem('Savings');
    expect(within(savings).getByText('0.50% a year, yearly')).toBeInTheDocument();
    expect(within(savings).queryByText('Loan')).not.toBeInTheDocument();
    expect(within(savings).queryByRole('button', { name: 'Update from statement' })).not.toBeInTheDocument();
  });

  test("a loan's row lists all its transactions the way a bank account lists its transfers", async () => {
    const tx = (id, accountId, date, vendor, amount, extra = {}) => ({
      id, account_id: accountId, date, vendor, category: 'Loan', notes: '', amount, amount_cents: Math.round(amount * 100),
      is_transfer: false, is_reimbursement: false, over_budget: false, recurring_id: null, loan_payment_id: null, ...extra,
    });
    const onDeleteTransferBulk = jest.fn();
    renderAccounts([
      account({ id: 16, account_name: 'Student Loan', kind: 'loan', apr: 6.7, balance: -75142 }),
      account({ id: 6, account_name: 'Checking' }),
    ], jest.fn(), { onDeleteTransferBulk, transactions: [
      tx(1, 16, '2026-09-30', 'ASPIRE', 75, { loan_payment_id: 11 }),
      tx(2, 16, '2026-11-01', 'Interest', -419.96),
      tx(3, 16, '2026-10-31', 'ASPIRE', 75, { loan_payment_id: 12 }),
      tx(11, 6, '2026-09-30', 'ASPIRE', -75, { recurring_id: 5 }),       // the payments, in Checking
      tx(12, 6, '2026-10-31', 'ASPIRE', -75, { recurring_id: 5 }),
    ] });
    // A bank account still expands to its transfers only, and has none here (checked first: once the
    // loan's list is open, "Checking" also names its entries' paying account)
    expect(within(accountItem('Checking')).getByTitle('No transfers')).toBeDisabled();
    const loan = accountItem('Student Loan');
    expect(within(loan).getByText('3 transactions')).toBeInTheDocument();
    await userEvent.click(within(loan).getByTitle('Show its transactions'));

    const list = loan.querySelector('.account-transfers');
    expect(within(list).getByText('Transactions (3)')).toBeInTheDocument();
    expect(loan.querySelector('.transaction-item')).toBeNull();          // not the Recurring tab's list
    // By vendor, newest first, each with its money in and out
    expect([...list.querySelectorAll('.transfer-vendor-group')].map(group =>
      [group.querySelector('.transfer-vendor-name').textContent, group.querySelector('.transfer-vendor-flows').textContent]))
      .toEqual([['Interest', '$419.96 out'], ['ASPIRE', '$150.00 in']]);
    const rows = [...list.querySelectorAll('.account-transfer-row')];
    expect(rows.map(row => ['.account-transfer-amount', '.account-transfer-direction', '.account-transfer-peer', '.account-transfer-date']
      .map(sel => row.querySelector(sel).textContent))).toEqual([
      ['-$419.96', '', '', 'Nov 1'],
      ['+$75.00', 'From', 'Checking', 'Oct 31'],          // a loan entry: the account its payment came from
      ['+$75.00', 'From', 'Checking', 'Sep 30'],
    ]);
    // Loan entries are read-only; anything else can be edited, deleted and selected
    expect(within(rows[1]).getByText('Loan entry')).toBeInTheDocument();
    expect(within(rows[1]).queryByTitle('Edit')).not.toBeInTheDocument();
    expect(within(rows[1]).getByRole('checkbox')).toBeDisabled();
    expect(within(rows[0]).getByTitle('Edit')).toBeInTheDocument();
    expect(within(rows[0]).getByTitle('Delete')).toBeInTheDocument();
    // Selecting every row selects the ones that can change; there's no Move (that re-links transfers)
    await userEvent.click(within(list).getByRole('checkbox', { name: 'Transactions (3)' }));
    expect(within(list).getByText('1 of 3 selected')).toBeInTheDocument();
    expect(within(list).queryByText(/^Move/)).not.toBeInTheDocument();
    await userEvent.click(within(list).getByRole('button', { name: 'Delete 1' }));
    expect(onDeleteTransferBulk).toHaveBeenCalledWith([2]);
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

describe("a bank account's transfers", () => {
  const tx = (id, accountId, date, vendor, amount, extra = {}) => ({
    id, account_id: accountId, date, vendor, category: 'Transfer', notes: '', amount, amount_cents: Math.round(amount * 100),
    is_transfer: true, is_reimbursement: false, over_budget: false, recurring_id: null, loan_payment_id: null,
    transfer_peer_id: null, transfer_peer_account: null, ...extra,
  });
  const ACCOUNTS = [account({ id: 6, account_name: 'Checking' }), account({ id: 7, account_name: 'Savings' })];
  const TRANSACTIONS = [
    tx(1, 6, '2026-10-05', 'To savings', -300, { transfer_peer_id: 9, transfer_peer_account: 'Savings', notes: 'monthly' }),
    tx(2, 6, '2026-09-20', 'Venmo', 45),
    tx(3, 6, '2026-10-02', 'Target', -20, { is_transfer: false, category: 'Grocery' }),      // not a transfer: not listed
    tx(9, 7, '2026-10-05', 'To savings', 300, { transfer_peer_id: 1, transfer_peer_account: 'Checking' }),
  ];
  const open = async (handlers = {}) => {
    renderAccounts(ACCOUNTS, jest.fn(), { transactions: TRANSACTIONS, ...handlers });
    const checking = accountItem('Checking');
    await userEvent.click(within(checking).getByTitle('Expand transfers'));
    return checking.querySelector('.account-transfers');
  };

  test('are listed by vendor, newest first, each with the other account or "Unlinked"', async () => {
    const list = await open();
    expect(within(list).getByText('Transfers (2)')).toBeInTheDocument();
    expect([...list.querySelectorAll('.transfer-vendor-group')].map(group =>
      [group.querySelector('.transfer-vendor-name').textContent, group.querySelector('.transfer-vendor-flows').textContent]))
      .toEqual([['To savings', '$300.00 out'], ['Venmo', '$45.00 in']]);
    expect([...list.querySelectorAll('.account-transfer-row')].map(row =>
      ['.account-transfer-amount', '.account-transfer-direction', '.account-transfer-peer', '.account-transfer-date']
        .map(sel => row.querySelector(sel).textContent))).toEqual([
      ['-$300.00', 'To', 'Savings', 'Oct 5'],
      ['+$45.00', 'From', 'Unlinked', 'Sep 20'],
    ]);
  });

  test('a row is edited in place: date, vendor, amount and notes', async () => {
    const onEdit = jest.fn();
    const list = await open({ onEdit });
    const [first] = list.querySelectorAll('.account-transfer-row');
    await userEvent.click(within(first).getByTitle('Edit'));
    const amount = within(first).getByPlaceholderText('Amount');
    await userEvent.clear(amount);
    await userEvent.type(amount, '-350');
    await userEvent.click(within(first).getByRole('button', { name: 'Save' }));
    expect(onEdit).toHaveBeenCalledWith(1, { date: '2026-10-05', vendor: 'To savings', amount: '-350', notes: 'monthly',
                                             account_id: 6, category: 'Transfer' });
  });

  test('selected rows can be moved to another account or deleted', async () => {
    const onPairTransfer = jest.fn();
    const onDeleteTransferBulk = jest.fn();
    const list = await open({ onPairTransfer, onDeleteTransferBulk });
    await userEvent.click(within(list).getByRole('checkbox', { name: 'Transfers (2)' }));
    expect(within(list).getByText('2 of 2 selected')).toBeInTheDocument();
    expect(within(list).getByText('Move 2 to:')).toBeInTheDocument();
    await userEvent.selectOptions(list.querySelector('.transfer-bulk-bar select'), '7');
    await userEvent.click(within(list).getByRole('button', { name: 'Move' }));
    expect(onPairTransfer.mock.calls).toEqual([[1, 7], [2, 7]]);
    await userEvent.click(within(list).getByRole('button', { name: 'Delete 2' }));
    expect(onDeleteTransferBulk).toHaveBeenCalledWith([1, 2]);
  });
});

describe('goal progress on the row', () => {
  // GET /api/goals rows
  const goalRow = (id, accountId, kind, balanceCents, targetCents, active) => ({
    id, position: id, account_id: accountId, account_kind: kind, balance_cents: balanceCents, target_cents: targetCents,
    remaining_cents: Math.max(targetCents - balanceCents, 0), monthly_cents: null, reached: balanceCents >= targetCents, active,
  });
  const ACCOUNTS = [
    account({ id: 1, account_name: 'Checking' }),
    account({ id: 2, account_name: 'Savings', balance: 3000 }),
    account({ id: 16, account_name: 'Student Loan', kind: 'loan', apr: 6.7, interest_frequency: 'monthly', balance: -75217 }),
  ];
  const progress = (name) => {
    const goal = accountItem(name).querySelector('.account-goal');
    return goal && [goal.querySelector('.account-goal-text').textContent, goal.querySelector('.goal-status').textContent];
  };

  test("each account with a goal shows how far along it is and the goal's status", async () => {
    getGoals.mockResolvedValue([goalRow(1, 2, 'bank', 300000, 750000, true), goalRow(2, 16, 'loan', -7521700, 0, false)]);
    renderAccounts(ACCOUNTS);
    expect(await screen.findByText('Goal $7,500: 40% there, $4,500 to go')).toBeInTheDocument();
    expect(progress('Savings')).toEqual(['Goal $7,500: 40% there, $4,500 to go', 'Active']);
    expect(accountItem('Savings').querySelector('.goal-bar-fill')).toHaveStyle({ width: '40%' });
    expect(progress('Student Loan')).toEqual(['Goal: paid off, $75,217 to go', 'Waiting']);
    expect(progress('Checking')).toBeNull();
  });

  test('a reached goal says so', async () => {
    getGoals.mockResolvedValue([goalRow(1, 2, 'bank', 800000, 750000, false)]);
    renderAccounts(ACCOUNTS);
    expect(await screen.findByText('Goal $7,500: reached')).toBeInTheDocument();
    expect(progress('Savings')).toEqual(['Goal $7,500: reached', 'Reached']);
  });
});
