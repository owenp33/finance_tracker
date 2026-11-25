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
                        { onCreateAccount = jest.fn(), transactions = [], recurring = [], onDeleteTransferBulk = jest.fn(),
                          onEdit = jest.fn(), onPairTransfer = jest.fn(), interest = [], onEditInterest = jest.fn(),
                          onApproveInterest = jest.fn(), onDeleteInterest = jest.fn() } = {}) => {
  render(
    <AccountsView
      transactions={transactions} accounts={accounts} recurring={recurring} interest={interest}
      onEdit={onEdit} onDelete={jest.fn()} onPairTransfer={onPairTransfer} onDeleteTransferBulk={onDeleteTransferBulk}
      onCreateAccount={onCreateAccount} onEditAccount={onEditAccount} onDeleteAccount={jest.fn()}
      onEditInterest={onEditInterest} onApproveInterest={onApproveInterest} onDeleteInterest={onDeleteInterest}
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
  expect(within(item).getByText('Made by an import: check it, then edit or click “Looks good”.')).toHaveClass('needs-attention-hint');

  await userEvent.click(within(item).getByRole('button', { name: 'Looks good' }));
  expect(onEditAccount).toHaveBeenCalledWith(7, { needs_attention: false });
});

test('a reviewed account shows no flag', () => {
  renderAccounts([account()]);
  const item = accountItem('Checking');
  expect(within(item).queryByText('Needs attention')).not.toBeInTheDocument();
  expect(within(item).queryByRole('button', { name: 'Looks good' })).not.toBeInTheDocument();
});

// A phone shows an account row's Edit / Delete only once the row is tapped (its account-open class,
// styles/accounts.css), as a series card's; laptops show them always
describe('an account row on a phone', () => {
  const SAVINGS = account({ id: 2, account_id: 'savings-1', account_name: 'Savings', apr: 0.5, interest_frequency: 'yearly' });
  const WAITING = { id: 9, account_id: 2, date: '2027-01-01', amount: 15, amount_cents: 1500, apr: 0.5, frequency: 'yearly',
                    base_cents: 300000, approved: false };

  test("a tap opens a row's actions, one row at a time; its buttons and interest don't, and Edit closes it", async () => {
    renderAccounts([account(), SAVINGS], jest.fn(), { interest: [WAITING] });
    await userEvent.click(screen.getByText('Checking'));
    expect(accountItem('Checking')).toHaveClass('account-open');
    await userEvent.click(screen.getByText('Savings'));
    expect(accountItem('Savings')).toHaveClass('account-open');
    expect(accountItem('Checking')).not.toHaveClass('account-open');
    // The interest waiting for approval has its own buttons and editor: a tap there leaves the row as it is
    await userEvent.click(within(accountItem('Savings')).getByText('0.50% on $3,000.00'));
    expect(accountItem('Savings')).toHaveClass('account-open');
    await userEvent.click(screen.getByText('Savings'));
    expect(accountItem('Savings')).not.toHaveClass('account-open');

    await userEvent.click(screen.getByText('Checking'));
    await userEvent.click(within(accountItem('Checking')).getByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(accountItem('Checking')).not.toHaveClass('account-open');
  });

  test("each row's Edit and Delete have a word to show on a phone, under the same name", () => {
    renderAccounts([account()]);
    expect(within(accountItem('Checking')).getByRole('button', { name: 'Edit' })).toHaveTextContent('Edit');
    expect(within(accountItem('Checking')).getByRole('button', { name: 'Delete' })).toHaveTextContent('Delete');
  });
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
  expect(screen.getByText('Starting balance + transactions (+$100.00) = current balance.')).toBeInTheDocument();
  expect(screen.getByText('Before its first transaction here. Negative if owed.')).toBeInTheDocument();
  expect(screen.getByText('What your bank shows today, once every transaction to date is here.')).toBeInTheDocument();

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
    expect(screen.getByText("Charged on what's owed. Blank if unknown.")).toBeInTheDocument();
    expect(screen.getByText('On the 1st of each month, quarter or year.')).toBeInTheDocument();
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
    expect(screen.getByText('Paid on a positive balance. Blank if none.')).toBeInTheDocument();
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

  // The Student Loan's own interest, and ASPIRE's payments from Checking (its series pays the loan down)
  const loanTx = (id, accountId, date, vendor, amount, extra = {}) => ({
    id, account_id: accountId, date, vendor, category: 'Loan', notes: '', amount, amount_cents: Math.round(amount * 100),
    is_transfer: false, is_reimbursement: false, over_budget: false, recurring_id: null, ...extra,
  });
  const LOAN_ACCOUNTS = [
    account({ id: 16, account_name: 'Student Loan', kind: 'loan', apr: 6.7, balance: -75142 }),
    account({ id: 6, account_name: 'Checking' }),
  ];
  const LOAN_TRANSACTIONS = [
    loanTx(2, 16, '2026-11-01', 'Interest', -419.96),
    loanTx(11, 6, '2026-09-30', 'ASPIRE', -75, { recurring_id: 5 }),
    loanTx(12, 6, '2026-10-31', 'ASPIRE', -75, { recurring_id: 5 }),
    loanTx(13, 6, '2026-10-15', 'Spotify', -9.99, { recurring_id: 6 }),      // a series paying nothing down
  ];
  const LOAN_RECURRING = [{ id: 5, account_id: 6, loan_account_id: 16 }, { id: 6, account_id: 6, loan_account_id: null }];
  const openLoan = async (options = {}) => {
    renderAccounts(LOAN_ACCOUNTS, jest.fn(), { transactions: LOAN_TRANSACTIONS, recurring: LOAN_RECURRING, ...options });
    const loan = accountItem('Student Loan');
    await userEvent.click(within(loan).getByTitle('Show its transactions'));
    return loan.querySelector('.account-transfers');
  };
  const loanRows = (list) => [...list.querySelectorAll('.account-transfer-row')];

  test("a loan's row lists its own transactions and the payments paying it down, the way a bank account lists its transfers", async () => {
    const onDeleteTransferBulk = jest.fn();
    renderAccounts(LOAN_ACCOUNTS, jest.fn(), { onDeleteTransferBulk, transactions: LOAN_TRANSACTIONS, recurring: LOAN_RECURRING });
    // A bank account still expands to its transfers only, and has none here
    expect(within(accountItem('Checking')).getByTitle('No transfers')).toBeDisabled();
    const loan = accountItem('Student Loan');
    expect(within(loan).getByText('3 transactions')).toBeInTheDocument();
    await userEvent.click(within(loan).getByTitle('Show its transactions'));

    const list = loan.querySelector('.account-transfers');
    expect(within(list).getByText('Transactions (3)')).toBeInTheDocument();
    expect(loan.querySelector('.transaction-item')).toBeNull();          // not the Recurring tab's list
    // By vendor, newest first, each with its money in and out; a payment as it is, from the account it was paid from
    expect([...list.querySelectorAll('.transfer-vendor-group')].map(group =>
      [group.querySelector('.transfer-vendor-name').textContent, group.querySelector('.transfer-vendor-flows').textContent]))
      .toEqual([['Interest', '$419.96 out'], ['ASPIRE', '$150.00 out']]);
    const rows = loanRows(list);
    expect(rows.map(row => ['.account-transfer-amount', '.account-transfer-direction', '.account-transfer-peer', '.account-transfer-date']
      .map(sel => row.querySelector(sel).textContent))).toEqual([
      ['-$419.96', '', '', 'Nov 1'],
      ['-$75.00', 'From', 'Checking', 'Oct 31'],
      ['-$75.00', 'From', 'Checking', 'Sep 30'],
    ]);
    // Nothing is locked: every row can be edited, deleted and selected
    expect(within(list).queryByText('Loan entry')).not.toBeInTheDocument();
    for (const row of rows) {
      expect(within(row).getByTitle('Edit')).toBeInTheDocument();
      expect(within(row).getByTitle('Delete')).toBeInTheDocument();
      expect(within(row).getByRole('checkbox')).toBeEnabled();
    }
    // There's no Move (that re-links transfers)
    await userEvent.click(within(list).getByRole('checkbox', { name: 'Transactions (3)' }));
    expect(within(list).getByText('3 of 3 selected')).toBeInTheDocument();
    expect(within(list).queryByText(/^Move/)).not.toBeInTheDocument();
    await userEvent.click(within(list).getByRole('button', { name: 'Delete 3' }));
    expect(onDeleteTransferBulk).toHaveBeenCalledWith([2, 11, 12]);
  });

  test("editing a payment from the loan's list edits the payment itself, in the account it was paid from", async () => {
    const onEdit = jest.fn();
    const list = await openLoan({ onEdit });
    const [, october] = loanRows(list);
    await userEvent.click(within(october).getByTitle('Edit'));
    const amount = within(list).getByPlaceholderText('Amount');
    await userEvent.clear(amount);
    await userEvent.type(amount, '-80');
    await userEvent.click(within(list).getByRole('button', { name: 'Save' }));
    expect(onEdit).toHaveBeenCalledWith(12, { date: '2026-10-31', vendor: 'ASPIRE', amount: '-80', notes: '', account_id: 6, category: 'Loan' });
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

test("the Accounts tab's count adds the interest waiting for approval", () => {
  const hit = (id, accountId, approved) => ({
    id, account_id: accountId, date: '2026-12-01', amount: -1, amount_cents: -100, apr: 6.7, frequency: 'monthly', base_cents: 1, approved,
  });
  render(
    <CategoryColorProvider>
      <TransactionsView
        transactions={[]} recurringTransactions={[]}
        accounts={[account({ id: 1, needs_attention: true }), account({ id: 2, account_name: 'Savings' })]}
        interest={[hit(7, 2, false), hit(8, 1, false), hit(6, 2, true)]}
      />
    </CategoryColorProvider>
  );
  const tab = screen.getByRole('button', { name: /^Accounts/ });
  expect(within(tab).getByText('3')).toHaveClass('attention-badge');
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
    is_transfer: true, is_reimbursement: false, over_budget: false, recurring_id: null,
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

  // On a phone a tap on a row opens its actions (GroupedTransactionList); the other account's name and
  // "Unlinked" are buttons of their own, so a tap there opens their picker and leaves the row alone
  test("a tap on the other account's name, or on Unlinked, opens its picker, not the row's actions", async () => {
    const list = await open();
    const [first, second] = list.querySelectorAll('.account-transfer-row');
    await userEvent.click(within(first).getByRole('button', { name: 'Savings' }));
    expect(within(first).getByRole('button', { name: 'Move' })).toBeInTheDocument();
    expect(first).not.toHaveClass('transfer-open');
    await userEvent.click(within(second).getByRole('button', { name: 'Unlinked' }));
    expect(within(second).getByRole('button', { name: 'Link' })).toBeInTheDocument();
    expect(second).not.toHaveClass('transfer-open');
  });

  // Across years each date shows its year, in a piece of its own that a phone leaves out of an
  // account's list (styles/accounts.css), so a transfer fits one line there (Owen, 2026-11-24)
  test('across years a date carries its year in a piece a phone can leave out', async () => {
    renderAccounts(ACCOUNTS, jest.fn(), { transactions: [...TRANSACTIONS, tx(4, 6, '2025-12-30', 'Venmo', 20)] });
    const checking = accountItem('Checking');
    await userEvent.click(within(checking).getByTitle('Expand transfers'));
    const dates = [...checking.querySelectorAll('.account-transfer-date')];
    expect(dates.map(d => d.textContent)).toEqual(['Oct 5, 2026', 'Sep 20, 2026', 'Dec 30, 2025']);
    expect(dates.map(d => d.querySelector('.transfer-date-year')?.textContent)).toEqual([', 2026', ', 2026', ', 2025']);
  });
});

describe('interest waiting for approval', () => {
  // GET /api/interest rows, newest first: the Student Loan charged monthly, Savings paid yearly
  const hit = (id, accountId, date, cents, apr, frequency, baseCents, approved = false) => ({
    id, account_id: accountId, date, amount: cents / 100, amount_cents: cents, apr, frequency, base_cents: baseCents, approved,
  });
  const ACCOUNTS = [
    account({ id: 1, account_name: 'Checking' }),
    account({ id: 2, account_name: 'Savings', balance: 3015, apr: 0.5, interest_frequency: 'yearly' }),
    account({ id: 16, account_name: 'Student Loan', kind: 'loan', apr: 6.7, interest_frequency: 'monthly', balance: -76059.27 }),
  ];
  const INTEREST = [
    hit(9, 2, '2027-01-01', 1500, 0.5, 'yearly', 300000),
    hit(8, 16, '2027-01-01', -42231, 6.7, 'monthly', 7563696),
    hit(7, 16, '2026-12-01', -41996, 6.7, 'monthly', 7521700),
    hit(6, 16, '2026-11-01', -41762, 6.7, 'monthly', 7480000, true),     // approved: applied, and gone from the list
    hit(5, 1, '2026-11-01', 100, 1, 'monthly', 120000, true),            // Checking's only one, approved
  ];
  const rows = (name) => [...accountItem(name).querySelectorAll('.account-interest-row')].map(row =>
    ['.account-interest-date', '.account-interest-basis', '.account-interest-amount'].map(sel => row.querySelector(sel)?.textContent));

  test("an account's charges waiting for approval show under its row; approved ones, and accounts with none, show nothing", () => {
    renderAccounts(ACCOUNTS, jest.fn(), { interest: INTEREST });
    expect(accountItem('Checking').querySelector('.account-interest')).toBeNull();
    const loan = accountItem('Student Loan');
    expect(within(loan).getByText('Interest to approve (2)')).toBeInTheDocument();
    // Oldest first, the order they're approved in (the server lists them newest first)
    expect(rows('Student Loan')).toEqual([
      ['Dec 1, 2026', '6.70% on $75,217.00 owed', '-$419.96'],
      ['Jan 1, 2027', '6.70% on $75,636.96 owed', '-$422.31'],
    ]);
    expect(within(accountItem('Savings')).getByText('Interest to approve (1)')).toBeInTheDocument();
    expect(rows('Savings')).toEqual([['Jan 1, 2027', '0.50% on $3,000.00', '+$15.00']]);
    // Not transactions: the loan has none to list
    expect(within(loan).getByTitle('No transactions')).toBeDisabled();
  });

  test('a charge is approved on its own, or all of them at once, oldest first', async () => {
    const onApproveInterest = jest.fn().mockResolvedValue(true);
    renderAccounts(ACCOUNTS, jest.fn(), { interest: INTEREST, onApproveInterest });
    const loan = accountItem('Student Loan');
    const [december] = loan.querySelectorAll('.account-interest-row');
    await userEvent.click(within(december).getByRole('button', { name: 'Approve interest' }));
    expect(onApproveInterest).toHaveBeenLastCalledWith([7]);
    await userEvent.click(within(loan).getByRole('button', { name: 'Approve all' }));
    expect(onApproveInterest).toHaveBeenLastCalledWith([7, 8]);
    // With one waiting, there's no Approve all
    expect(within(accountItem('Savings')).queryByRole('button', { name: 'Approve all' })).not.toBeInTheDocument();
  });

  test('a charge is deleted once confirmed', async () => {
    const onDeleteInterest = jest.fn().mockResolvedValue(true);
    window.confirm = jest.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderAccounts(ACCOUNTS, jest.fn(), { interest: INTEREST, onDeleteInterest });
    const savings = accountItem('Savings');
    await userEvent.click(within(savings).getByRole('button', { name: 'Delete interest' }));
    expect(window.confirm).toHaveBeenCalledWith("Delete the interest for Jan 1, 2027 (+$15.00)? It won't be booked again.");
    expect(onDeleteInterest).not.toHaveBeenCalled();
    await userEvent.click(within(savings).getByRole('button', { name: 'Delete interest' }));
    expect(onDeleteInterest).toHaveBeenCalledWith(9);
  });

  test("a charge is changed to the bank's figure, and its form closes once the change is saved", async () => {
    const onEditInterest = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderAccounts(ACCOUNTS, jest.fn(), { interest: INTEREST, onEditInterest });
    const loan = accountItem('Student Loan');
    const [december] = loan.querySelectorAll('.account-interest-row');
    await userEvent.click(within(december).getByRole('button', { name: 'Edit interest' }));
    const amount = within(loan).getByLabelText('Interest charged on Dec 1, 2026');
    expect(amount).toHaveValue(419.96);
    expect(within(december).getByText('Charged')).toBeInTheDocument();
    await userEvent.clear(amount);
    await userEvent.type(amount, '425.10');
    await userEvent.click(within(loan).getByRole('button', { name: 'Save' }));
    expect(onEditInterest).toHaveBeenCalledWith(7, 425.1);
    expect(within(loan).getByLabelText('Interest charged on Dec 1, 2026')).toBeInTheDocument();   // refused: still open
    await userEvent.click(within(loan).getByRole('button', { name: 'Save' }));
    expect(onEditInterest).toHaveBeenCalledTimes(2);
    expect(within(loan).queryByLabelText('Interest charged on Dec 1, 2026')).not.toBeInTheDocument();
  });

  test('saving needs an amount, and Cancel leaves the hit as it was', async () => {
    const onEditInterest = jest.fn();
    renderAccounts(ACCOUNTS, jest.fn(), { interest: INTEREST, onEditInterest });
    const savings = accountItem('Savings');
    await userEvent.click(within(savings).getByRole('button', { name: 'Edit interest' }));
    expect(within(savings).getByText('Paid')).toBeInTheDocument();
    await userEvent.clear(within(savings).getByLabelText('Interest paid on Jan 1, 2027'));
    expect(within(savings).getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.click(within(savings).getByRole('button', { name: 'Cancel' }));
    expect(rows('Savings')).toEqual([['Jan 1, 2027', '0.50% on $3,000.00', '+$15.00']]);
    expect(onEditInterest).not.toHaveBeenCalled();
  });

  test("the edit form's sum says nothing of interest (the Transactions section doesn't)", async () => {
    renderAccounts(ACCOUNTS, jest.fn(), { interest: INTEREST });
    await startEditing('Savings');
    expect(screen.getByText('Starting balance + transactions (+$3,015.00) = current balance.')).toBeInTheDocument();
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
