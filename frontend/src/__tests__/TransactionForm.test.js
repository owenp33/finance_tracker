import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TransactionForm from '../components/TransactionForm';
import { todayISO } from '../utils/dates';

const renderRecurringForm = () => {
  const onSubmitRecurring = jest.fn();
  const { container } = render(
    <TransactionForm
      onSubmit={jest.fn()} onSubmitRecurring={onSubmitRecurring} onCancel={jest.fn()}
      accounts={[{ id: 1, account_name: 'Discover' }]} defaultRecurring
    />
  );
  return { onSubmitRecurring, container };
};

const fillAndSubmit = async (container) => {
  await userEvent.type(screen.getByPlaceholderText('e.g., Netflix'), 'Anthropic');
  await userEvent.type(screen.getByPlaceholderText('e.g., Subscriptions'), 'Subscriptions');
  await userEvent.type(container.querySelector('input[step="0.01"]'), '-20');
  await userEvent.click(screen.getByRole('button', { name: 'Add Recurring' }));
};

test('a new recurring template repeats monthly by default', async () => {
  const { onSubmitRecurring, container } = renderRecurringForm();
  expect(screen.getByLabelText('Repeats')).toHaveDisplayValue('Monthly');
  await fillAndSubmit(container);
  expect(onSubmitRecurring).toHaveBeenCalledWith(expect.objectContaining({ frequency: 1, frequency_unit: 'months' }));
});

const setDate = (container, value) =>
  fireEvent.change(container.querySelector('input[type="date"]'), { target: { value } });

test('starting today adds nothing extra and needs no warning', async () => {
  const { onSubmitRecurring, container } = renderRecurringForm();
  expect(container.querySelector('input[type="date"]')).toHaveValue(todayISO());
  expect(screen.queryByLabelText('Also add the past occurrences')).not.toBeInTheDocument();
  await fillAndSubmit(container);
  expect(onSubmitRecurring).toHaveBeenCalledWith(expect.objectContaining({ skip_past: false }));
});

test('a past date skips the past occurrences unless asked', async () => {
  const { onSubmitRecurring, container } = renderRecurringForm();
  setDate(container, '2025-01-31');
  expect(screen.getByText(/This date is in the past/)).toBeInTheDocument();
  const includePast = screen.getByLabelText('Also add the past occurrences');
  expect(includePast).not.toBeChecked();
  await fillAndSubmit(container);
  expect(onSubmitRecurring).toHaveBeenLastCalledWith(expect.objectContaining({ start_date: '2025-01-31', skip_past: true }));
});

test('past occurrences are added when asked', async () => {
  const { onSubmitRecurring, container } = renderRecurringForm();
  setDate(container, '2025-01-31');
  await userEvent.click(screen.getByLabelText('Also add the past occurrences'));
  await fillAndSubmit(container);
  expect(onSubmitRecurring).toHaveBeenLastCalledWith(expect.objectContaining({ skip_past: false }));
});

test('choosing biweekly repeats every 14 days', async () => {
  const { onSubmitRecurring, container } = renderRecurringForm();
  await userEvent.selectOptions(screen.getByLabelText('Repeats'), 'Biweekly');
  await fillAndSubmit(container);
  expect(onSubmitRecurring).toHaveBeenCalledWith(expect.objectContaining({ frequency: 14, frequency_unit: 'days' }));
});
