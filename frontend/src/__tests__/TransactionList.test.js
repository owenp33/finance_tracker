import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TransactionList from '../components/TransactionList';

// Provide the context hook so TransactionList doesn't crash
jest.mock('../CategoryColorContext', () => ({
  useCategoryColors: () => ({ getColor: () => '#999999' }),
}));

const ACCOUNTS = [{ id: 1, account_name: 'Test Checking' }];

const TX = {
  id: 1,
  date: '2026-01-15',
  vendor: 'Netflix',
  category: 'Subscriptions',
  amount: -20.00,
  amount_cents: -2000,
  notes: '',
  account_id: 1,
  is_transfer: false,
  over_budget: false,
};

function renderList(props = {}) {
  return render(
    <TransactionList
      transactions={[TX]}
      accounts={ACCOUNTS}
      onEdit={jest.fn()}
      onDelete={jest.fn()}
      onToggleTransfer={jest.fn()}
      showAll={true}
      {...props}
    />
  );
}

// ── Rendering ─────────────────────────────────────────────────────────────────

test('renders vendor name', () => {
  renderList();
  expect(screen.getByText('Netflix')).toBeInTheDocument();
});

test('renders formatted amount', () => {
  renderList();
  expect(screen.getByText('-$20.00')).toBeInTheDocument();
});

test('shows no-data message when transactions empty', () => {
  render(<TransactionList transactions={[]} />);
  expect(screen.getByText('No transactions found')).toBeInTheDocument();
});

test('renders checkbox when onToggle provided', () => {
  renderList({ onToggle: jest.fn(), selectedIds: new Set() });
  expect(screen.getByRole('checkbox')).toBeInTheDocument();
});

// ── Edit form ─────────────────────────────────────────────────────────────────

async function openEditForm() {
  const user = userEvent.setup();
  renderList();
  // Hover to reveal buttons, then click Edit
  const item = screen.getByText('Netflix').closest('.transaction-item');
  await user.hover(item);
  const editBtn = within(item).getByTitle('Edit');
  await user.click(editBtn);
}

test('edit form appears after clicking Edit', async () => {
  await openEditForm();
  expect(screen.getByDisplayValue('Netflix')).toBeInTheDocument();
  expect(screen.getByDisplayValue('-20')).toBeInTheDocument();
});

test('Save button is disabled when no fields changed', async () => {
  await openEditForm();
  const saveBtn = screen.getByRole('button', { name: 'Save' });
  expect(saveBtn).toBeDisabled();
});

test('Save button enables after changing vendor', async () => {
  const user = userEvent.setup();
  await openEditForm();
  const vendorInput = screen.getByDisplayValue('Netflix');
  await user.clear(vendorInput);
  await user.type(vendorInput, 'Hulu');
  expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
});

test('Save button enables after changing amount', async () => {
  const user = userEvent.setup();
  await openEditForm();
  const amountInput = screen.getByDisplayValue('-20');
  await user.clear(amountInput);
  await user.type(amountInput, '-25');
  expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
});

test('Save calls onEdit with updated fields', async () => {
  const onEdit = jest.fn().mockResolvedValue();
  const user = userEvent.setup();
  render(
    <TransactionList
      transactions={[TX]}
      accounts={ACCOUNTS}
      onEdit={onEdit}
      onDelete={jest.fn()}
      showAll={true}
    />
  );
  const item = screen.getByText('Netflix').closest('.transaction-item');
  await user.hover(item);
  await user.click(within(item).getByTitle('Edit'));

  const vendorInput = screen.getByDisplayValue('Netflix');
  await user.clear(vendorInput);
  await user.type(vendorInput, 'Hulu');
  await user.click(screen.getByRole('button', { name: 'Save' }));

  expect(onEdit).toHaveBeenCalledWith(1, expect.objectContaining({ vendor: 'Hulu' }));
});

test('Cancel closes edit form', async () => {
  const user = userEvent.setup();
  await openEditForm();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByLabelText('Vendor')).not.toBeInTheDocument();
});
