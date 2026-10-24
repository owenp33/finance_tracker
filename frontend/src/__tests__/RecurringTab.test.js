import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecurringTab from '../components/transactions/RecurringTab';

const template = (overrides) => ({
  id: 1, date: '2026-04-02', vendor: 'Anthropic', category: 'Subscriptions', amount: -20, notes: '',
  next_date: '2026-11-03', last_date: '2026-10-03', frequency: 1, frequency_unit: 'months',
  number: -1, idx: 8, ...overrides,
});

const renderTab = (recurring, onEditRecurring = jest.fn()) => {
  render(
    <RecurringTab
      transactions={[]} accounts={[{ id: 1, account_name: 'Discover' }]} recurringTransactions={recurring}
      onAdd={jest.fn()} onAddRecurring={jest.fn()} onEdit={jest.fn()} onDelete={jest.fn()} onDeleteMany={jest.fn()}
      onToggleTransfer={jest.fn()} onToggleTransferMany={jest.fn()}
      onEditRecurring={onEditRecurring} onDeleteRecurring={jest.fn()}
    />
  );
  return onEditRecurring;
};

test('each template shows its schedule and next date', () => {
  renderTab([
    template(),
    template({ id: 2, vendor: 'Old plan', frequency: 30, frequency_unit: 'days', next_date: '2026-10-29' }),
  ]);
  expect(screen.getByText(/Subscriptions · Monthly · Next: Nov 3$/)).toBeInTheDocument();
  expect(screen.getByText(/Every 30 days · Next: Oct 29$/)).toBeInTheDocument();
});

test('a finished template shows its last occurrence', () => {
  renderTab([template({ date: '2025-12-31', number: 3, idx: 4, next_date: '2026-03-31', last_date: '2026-02-28' })]);
  expect(screen.getByText(/Last: Feb 28, 2026$/)).toBeInTheDocument();
});

const optionLabels = (select) => within(select).getAllByRole('option').map(o => o.textContent);

test('editing offers the five schedules', async () => {
  renderTab([template()]);
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
  const repeats = screen.getByLabelText('Repeats');
  expect(optionLabels(repeats)).toEqual(['Weekly', 'Biweekly', 'Monthly', 'Quarterly', 'Annually']);
  expect(repeats).toHaveDisplayValue('Monthly');
});

test('an older schedule asks for a new one and keeps its own until then', async () => {
  const onEditRecurring = renderTab([template({ frequency: 30, frequency_unit: 'days' })], jest.fn().mockResolvedValue());
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }));

  const repeats = screen.getByLabelText('Repeats');
  expect(optionLabels(repeats)).toEqual(['Choose a schedule', 'Weekly', 'Biweekly', 'Monthly', 'Quarterly', 'Annually']);
  expect(repeats).toHaveDisplayValue('Choose a schedule');
  expect(within(repeats).getByRole('option', { name: 'Choose a schedule' })).toBeDisabled();

  await userEvent.selectOptions(repeats, 'Monthly');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onEditRecurring).toHaveBeenCalledWith(1, expect.objectContaining({ frequency: 1, frequency_unit: 'months' }));
});
