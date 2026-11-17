import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GoalsSection from '../components/goals/GoalsSection';
import { useGoalPlan } from '../hooks/useGoalPlan';
import { getGoals, createGoal, updateGoal, deleteGoal, reorderGoals } from '../api/goals';
import { getProjection } from '../api/recurring';

jest.mock('../api/goals');
jest.mock('../api/recurring');

// GET /api/goals rows, in order
const goal = (id, position, accountId, accountName, kind, balanceCents, targetCents, extra = {}) => ({
  id, position, account_id: accountId, account_name: accountName, account_kind: kind,
  balance: balanceCents / 100, balance_cents: balanceCents, target: targetCents / 100, target_cents: targetCents,
  remaining_cents: Math.max(targetCents - balanceCents, 0), monthly: null, monthly_cents: null,
  reached: balanceCents >= targetCents, active: false, ...extra,
});
const SAVINGS_GOAL = goal(1, 1, 7, 'Savings', 'bank', 300000, 750000, { active: true });
const LOAN_GOAL = goal(2, 2, 16, 'Student Loan', 'loan', -7521700, 0);

const ACCOUNTS = [
  { id: 6, account_name: 'Checking', kind: 'bank', apr: null, balance: 7000 },
  { id: 7, account_name: 'Savings', kind: 'bank', apr: null, balance: 3000 },
  { id: 16, account_name: 'Student Loan', kind: 'loan', apr: 6.7, interest_frequency: 'monthly', balance: -75217 },
];
// ASPIRE pays the loan $75 a month
const RECURRING = [{ id: 5, amount: -75, frequency: 1, frequency_unit: 'months', number: -1, idx: 1, loan_account_id: 16 }];
// Two $1,700 paychecks in the next 90 days and nothing else: $3,400 ÷ 3 = $1,133.33 of room a month
const PAYCHECKS = ['2026-12-01', '2026-12-15'].map(date => ({ recurring_id: 13, account_id: 7, date, vendor: 'Paycheck',
                                                              category: 'Income', amount: 1700 }));

let user;
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 10, 16, 12));   // Nov 16, 2026
  user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  getGoals.mockResolvedValue([SAVINGS_GOAL, LOAN_GOAL]);
  getProjection.mockResolvedValue(PAYCHECKS);
  [createGoal, updateGoal, deleteGoal, reorderGoals].forEach(fn => fn.mockResolvedValue({}));
});
afterEach(() => jest.useRealTimers());

// The section as the Budgeting page gives it: the plan from useGoalPlan
function Goals({ onError }) {
  const goalPlan = useGoalPlan({ accounts: ACCOUNTS, transactions: [], recurring: RECURRING, onError });
  return <GoalsSection accounts={ACCOUNTS} goalPlan={goalPlan} />;
}

const renderGoals = async (onError = jest.fn()) => {
  render(<Goals onError={onError} />);
  await waitFor(() => expect(screen.queryByText('Loading goals…')).not.toBeInTheDocument());
  return onError;
};
const rows = () => [...document.querySelectorAll('.goal-row')].map(row =>
  ['.goal-name', '.goal-status', '.goal-progress', '.goal-plan'].map(sel => row.querySelector(sel)?.textContent));
const row = (name) => screen.getByText(new RegExp(`^\\d\\. ${name}$`)).closest('.goal-row');

test('goals run in order: the active one gets the room, the next starts once it is reached', async () => {
  await renderGoals();
  await waitFor(() => expect(screen.getByText(/^Room each month: \$1,133\.33/)).toBeInTheDocument());
  // $4,500.00 to go at $1,133.33: 4 months; then the loan, charged 6.70% monthly and paid $75 all along
  expect(rows()).toEqual([
    ['1. Savings', 'Active', '$3,000.00 of $7,500.00', '$1,133.33 a month (suggested) · reached by Mar 2027'],
    ['2. Student Loan', 'Waiting', '$75,217.00 owed · goal: paid off', 'After Savings · $1,133.33 a month (suggested) · paid off by Oct 2033'],
  ]);
  expect(row('Savings').querySelector('.goal-bar-fill')).toHaveStyle({ width: '40%' });
});

test('a reached goal is held, and the next one is active', async () => {
  getGoals.mockResolvedValue([{ ...SAVINGS_GOAL, balance_cents: 800000, remaining_cents: 0, reached: true, active: false },
                              { ...LOAN_GOAL, active: true }]);
  await renderGoals();
  expect(rows()[0]).toEqual(['1. Savings', 'Reached', '$8,000.00 of $7,500.00', 'Reached: keep it at $7,500.00 or more']);
  expect(rows()[1][1]).toBe('Active');
});

test('a goal is added with its account and target, and its own monthly amount if given', async () => {
  getGoals.mockResolvedValue([]);
  await renderGoals();
  expect(screen.getByText(/^No goals yet/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '+ Add goal' }));
  await user.selectOptions(screen.getByLabelText('Account'), 'Savings');
  await user.type(screen.getByLabelText('Target balance'), '7500');
  await user.click(screen.getByRole('button', { name: 'Add goal' }));
  expect(createGoal).toHaveBeenCalledWith({ account_id: 7, target: 7500, monthly: null });
  expect(getGoals).toHaveBeenCalledTimes(2);                                   // reloaded

  await user.click(await screen.findByRole('button', { name: '+ Add goal' }));   // the form closes once reloaded
  await user.selectOptions(screen.getByLabelText('Account'), 'Student Loan');
  expect(screen.getByLabelText('Target balance')).toHaveValue(0);              // a loan's goal: paid off
  await user.type(screen.getByLabelText('Monthly amount'), '500');
  await user.click(screen.getByRole('button', { name: 'Add goal' }));
  expect(createGoal).toHaveBeenLastCalledWith({ account_id: 16, target: 0, monthly: 500 });
});

test("editing sets the target and the goal's own monthly amount; a blank amount goes back to the suggestion", async () => {
  await renderGoals();
  await user.click(within(row('Savings')).getByRole('button', { name: 'Edit' }));
  await user.clear(screen.getByLabelText('Target balance'));
  await user.type(screen.getByLabelText('Target balance'), '8000');
  await user.type(screen.getByLabelText('Monthly amount'), '500');
  getGoals.mockResolvedValue([{ ...SAVINGS_GOAL, monthly: 500, monthly_cents: 50000 }, LOAN_GOAL]);   // what the reload returns
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(updateGoal).toHaveBeenCalledWith(1, { target: 8000, monthly: 500 });
  await waitFor(() => expect(rows()[0][3]).toMatch(/\(yours\)/));

  await user.click(within(row('Savings')).getByRole('button', { name: 'Edit' }));
  expect(screen.getByLabelText('Monthly amount')).toHaveValue(500);
  await user.clear(screen.getByLabelText('Monthly amount'));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(updateGoal).toHaveBeenLastCalledWith(1, { target: 7500, monthly: null });
});

test("a goal's own amount shows as yours", async () => {
  getGoals.mockResolvedValue([{ ...SAVINGS_GOAL, monthly: 500, monthly_cents: 50000 }]);
  await renderGoals();
  expect(rows()[0][3]).toBe('$500.00 a month (yours) · reached by Aug 2027');
});

test('goals move up and down, and are deleted after a confirm', async () => {
  await renderGoals();
  await user.click(within(row('Savings')).getByRole('button', { name: 'Move down' }));
  expect(reorderGoals).toHaveBeenCalledWith([2, 1]);
  expect(within(row('Savings')).getByRole('button', { name: 'Move up' })).toBeDisabled();

  window.confirm = jest.fn(() => true);
  await user.click(within(row('Student Loan')).getByRole('button', { name: 'Delete' }));
  expect(window.confirm).toHaveBeenCalledWith('Delete the goal for Student Loan?');
  expect(deleteGoal).toHaveBeenCalledWith(2);
});

test('without room, the active goal is not reached at this pace', async () => {
  getProjection.mockResolvedValue([]);
  await renderGoals();
  expect(screen.getByText('Room each month: none (spending is at or above scheduled income over the next 90 days)')).toBeInTheDocument();
  expect(rows()[0][3]).toBe('Nothing goes toward it · not reached at this pace');
});

test('a failed load is reported', async () => {
  getGoals.mockRejectedValue(new Error('Could not load goals'));
  const onError = jest.fn();
  render(<Goals onError={onError} />);
  await waitFor(() => expect(onError).toHaveBeenCalledWith('Could not load goals'));
});
