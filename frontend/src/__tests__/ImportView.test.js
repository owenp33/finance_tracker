import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ImportView from '../components/ImportView';
import { previewImport } from '../api/imports';

jest.mock('../api/imports');

const ACCOUNTS = [{ id: 1, account_name: 'Checking' }];

const previewRow = (overrides) => ({
  date: '2025-01-15', vendor: 'Grocer', category: 'Groceries', amount: -5, notes: '',
  account_id: 1, account_name: 'Checking', new_account: false, duplicate: false, zero_amount: false,
  invalid_date: false, invalid_amount: false, is_transfer: false, ...overrides,
});

const summary = (overrides) => ({
  total: 0, importable: 0, duplicates: 0, unmatched: 0, zero_amount: 0,
  invalid_date: 0, invalid_amount: 0, new_accounts: [], ...overrides,
});

const chooseFile = async (accounts = ACCOUNTS) => {
  const { container } = render(
    <ImportView accounts={accounts} onImportDone={jest.fn()} onNavigateAway={jest.fn()} />
  );
  await userEvent.upload(container.querySelector('input[type="file"]'), new File(['x'], 'bank.csv', { type: 'text/csv' }));
};

const showPreview = async (rows, previewSummary, accounts) => {
  previewImport.mockResolvedValue({ rows, summary: previewSummary });
  await chooseFile(accounts);
  await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
};

test('creating accounts automatically is the default, and those rows are pre-selected', async () => {
  await showPreview(
    [previewRow({ vendor: 'Coffee', account_id: null, account_name: 'Amex Gold', new_account: true })],
    summary({ total: 1, importable: 1, new_accounts: ['Amex Gold'] }),
  );

  expect(previewImport).toHaveBeenCalledWith(expect.any(File), { unmatched: 'create', targetAccountId: null });
  expect(await screen.findByText('1 new account')).toBeInTheDocument();
  expect(screen.getByText(/New accounts will be created: Amex Gold/)).toBeInTheDocument();

  const row = screen.getByText('Coffee').closest('tr');
  expect(within(row).getByText('new')).toHaveClass('new-account-badge');
  expect(within(row).getByRole('checkbox')).toBeEnabled();
  expect(within(row).getByRole('checkbox')).toBeChecked();
});

const unmatchedDropdown = () => screen.getByRole('combobox', { name: "When an account isn't found" });
const optionLabels = () => within(unmatchedDropdown()).getAllByRole('option').map(o => o.textContent);

test('the unmatched-accounts dropdown lists creating, each account, and skipping', async () => {
  await chooseFile([{ id: 1, account_name: 'Checking' }, { id: 2, account_name: 'Savings' }]);
  expect(optionLabels()).toEqual([
    'Create accounts automatically', 'Put rows into Checking', 'Put rows into Savings', 'Skip those rows',
  ]);
  expect(unmatchedDropdown()).toHaveDisplayValue('Create accounts automatically');
});

test('choosing an account sends its rows there', async () => {
  previewImport.mockResolvedValue({ rows: [], summary: summary() });
  await chooseFile();
  await userEvent.selectOptions(unmatchedDropdown(), 'Put rows into Checking');
  await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
  expect(previewImport).toHaveBeenCalledWith(expect.any(File), { unmatched: 'account', targetAccountId: '1' });
});

test('choosing to skip sends no account', async () => {
  previewImport.mockResolvedValue({ rows: [], summary: summary() });
  await chooseFile();
  await userEvent.selectOptions(unmatchedDropdown(), 'Skip those rows');
  await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
  expect(previewImport).toHaveBeenCalledWith(expect.any(File), { unmatched: 'skip', targetAccountId: null });
});

test('without any accounts, only creating or skipping is offered', async () => {
  await chooseFile([]);
  expect(optionLabels()).toEqual(['Create accounts automatically', 'Skip those rows']);
});

test('hovering a row that is not selected explains why', async () => {
  await showPreview(
    [
      previewRow({ vendor: 'Bad date', date: '1/5/25', invalid_date: true }),
      previewRow({ vendor: 'Nowhere', account_id: null, account_name: 'Unknown Bank' }),
      previewRow({ vendor: 'Seen before', duplicate: true }),
    ],
    summary({ total: 3, invalid_date: 1, unmatched: 1, duplicates: 1 }),
  );

  const reasonFor = (vendor) => screen.getByText(vendor).closest('tr').querySelector('td').getAttribute('title');
  expect(reasonFor('Bad date')).toBe('Unreadable date');
  expect(reasonFor('Nowhere')).toBe('No matching account');
  expect(reasonFor('Seen before')).toBe('Already in your transactions');
});

test('rows with unreadable dates show the original text and cannot be selected', async () => {
  await showPreview(
    [previewRow({ vendor: 'Good' }), previewRow({ vendor: 'Bad date', date: '1/5/25', invalid_date: true })],
    { total: 2, importable: 1, duplicates: 0, unmatched: 0, zero_amount: 0, invalid_date: 1 },
  );

  expect(await screen.findByText('1 invalid date')).toBeInTheDocument();

  const badRow = screen.getByText('Bad date').closest('tr');
  expect(within(badRow).getByText('1/5/25')).toHaveClass('csv-warning');
  expect(badRow).toHaveClass('invalid-date');
  expect(within(badRow).getByRole('checkbox')).toBeDisabled();
  expect(within(badRow).getByRole('checkbox')).not.toBeChecked();

  const goodRow = screen.getByText('Good').closest('tr');
  expect(within(goodRow).getByRole('checkbox')).toBeChecked();
  expect(screen.getAllByRole('button', { name: 'Import 1 row' })).toHaveLength(2);
});

test('rows with unreadable amounts show the original text and cannot be selected', async () => {
  await showPreview(
    [
      previewRow({ vendor: 'Good', amount: -12.34 }),
      previewRow({ vendor: 'Bad amount', amount: 'abc', invalid_amount: true }),
      previewRow({ vendor: 'No amount', amount: '', invalid_amount: true }),
    ],
    { total: 3, importable: 1, duplicates: 0, unmatched: 0, zero_amount: 0, invalid_date: 0, invalid_amount: 2 },
  );

  expect(await screen.findByText('2 invalid amounts')).toBeInTheDocument();
  expect(screen.getByText('−$12.34')).toBeInTheDocument();

  const badRow = screen.getByText('Bad amount').closest('tr');
  expect(within(badRow).getByText('abc')).toHaveClass('csv-warning');
  expect(badRow).toHaveClass('invalid-amount');
  expect(within(badRow).getByRole('checkbox')).toBeDisabled();
  expect(within(badRow).getByRole('checkbox')).not.toBeChecked();

  const blankRow = screen.getByText('No amount').closest('tr');
  expect(within(blankRow).getByText('missing')).toHaveClass('csv-warning');
});

test('a blank date is shown as missing', async () => {
  await showPreview(
    [previewRow({ vendor: 'No date', date: '', invalid_date: true })],
    { total: 1, importable: 0, duplicates: 0, unmatched: 0, zero_amount: 0, invalid_date: 1 },
  );

  const row = (await screen.findByText('No date')).closest('tr');
  expect(within(row).getByText('missing')).toHaveClass('csv-warning');
});
