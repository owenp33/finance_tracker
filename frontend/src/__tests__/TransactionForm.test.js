import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TransactionForm from '../components/TransactionForm';

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

const fillAndSubmit = async (container, user = userEvent) => {
  await user.type(screen.getByPlaceholderText('e.g., Netflix'), 'Anthropic');
  await user.type(screen.getByPlaceholderText('e.g., Subscriptions'), 'Subscriptions');
  await user.type(container.querySelector('input[step="0.01"]'), '-20');
  await user.click(screen.getByRole('button', { name: 'Add Recurring' }));
};

afterEach(() => jest.useRealTimers());

test('a new recurring template repeats monthly by default', async () => {
  const { onSubmitRecurring, container } = renderRecurringForm();
  expect(screen.getByLabelText('Repeats')).toHaveDisplayValue('Monthly');
  await fillAndSubmit(container);
  expect(onSubmitRecurring).toHaveBeenCalledWith(expect.objectContaining({ frequency: 1, frequency_unit: 'months' }));
});

const setDate = (container, value) =>
  fireEvent.change(container.querySelector('input[type="date"]'), { target: { value } });

test('starting today adds nothing extra and needs no warning', async () => {
  // A fixed clock: on the real one, a run crossing midnight saw the form's today and the test's differ
  jest.useFakeTimers().setSystemTime(new Date(2026, 10, 15, 12));
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const { onSubmitRecurring, container } = renderRecurringForm();
  expect(container.querySelector('input[type="date"]')).toHaveValue('2026-11-15');
  expect(screen.queryByLabelText('Also add the past occurrences')).not.toBeInTheDocument();
  await fillAndSubmit(container, user);
  expect(onSubmitRecurring).toHaveBeenCalledWith(expect.objectContaining({ start_date: '2026-11-15', skip_past: false }));
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

describe('"Mark as"', () => {
  const ACCOUNTS = [{ id: 6, account_name: 'Checking' }, { id: 7, account_name: 'Savings' }];
  const renderForm = () => {
    const handlers = { onSubmit: jest.fn(), onSubmitRecurring: jest.fn() };
    const { container } = render(<TransactionForm {...handlers} onCancel={jest.fn()} accounts={ACCOUNTS} />);
    return { ...handlers, container };
  };
  const pill = (name) => screen.getByRole('button', { name });
  const active = () => ['Transfer', 'Reimbursement', 'Recurring'].filter(name => pill(name).classList.contains('active'));
  const fill = async (container) => {
    await userEvent.type(screen.getByPlaceholderText('e.g., Netflix'), 'To savings');
    await userEvent.type(screen.getByPlaceholderText('e.g., Subscriptions'), 'Transfer');
    await userEvent.type(container.querySelector('input[step="0.01"]'), '-250');
  };

  test('Transfer, Reimbursement and Recurring are one choice, and Recurring shows its fields', async () => {
    renderForm();
    expect(screen.queryByRole('checkbox', { name: 'Make this recurring' })).not.toBeInTheDocument();
    expect(active()).toEqual([]);
    await userEvent.click(pill('Recurring'));
    expect(active()).toEqual(['Recurring']);
    expect(screen.getByLabelText('Repeats')).toBeInTheDocument();
    await userEvent.click(pill('Transfer'));
    expect(active()).toEqual(['Transfer']);
    expect(screen.queryByLabelText('Repeats')).not.toBeInTheDocument();
    await userEvent.click(pill('Reimbursement'));
    expect(active()).toEqual(['Reimbursement']);
    await userEvent.click(pill('Reimbursement'));
    expect(active()).toEqual([]);
  });

  test('Recurring adds a recurring template', async () => {
    const { onSubmitRecurring, container } = renderForm();
    await userEvent.click(pill('Recurring'));
    await fill(container);
    await userEvent.click(screen.getByRole('button', { name: 'Add Recurring' }));
    expect(onSubmitRecurring).toHaveBeenCalledWith(expect.objectContaining({ vendor: 'To savings', frequency_unit: 'months' }));
  });

  test('a transfer can name the account it goes to, which gets the matching transaction', async () => {
    const { onSubmit, container } = renderForm();
    expect(screen.queryByLabelText('To account')).not.toBeInTheDocument();
    await userEvent.click(pill('Transfer'));
    const to = screen.getByLabelText('To account');
    expect([...to.options].map(o => o.textContent)).toEqual(['None', 'Savings']);      // not the account it's from
    await userEvent.selectOptions(to, 'Savings');
    await fill(container);
    await userEvent.click(screen.getByRole('button', { name: 'Add Transaction' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ account_id: 6, is_transfer: true, transfer_to_account_id: 7 }));
  });

  test('turning Transfer off forgets its To account', async () => {
    const { onSubmit, container } = renderForm();
    await userEvent.click(pill('Transfer'));
    await userEvent.selectOptions(screen.getByLabelText('To account'), 'Savings');
    await userEvent.click(pill('Transfer'));
    await fill(container);
    await userEvent.click(screen.getByRole('button', { name: 'Add Transaction' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ is_transfer: false, transfer_to_account_id: null }));
  });
});
