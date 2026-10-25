import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecurringTab from '../components/transactions/RecurringTab';
import TransactionsView from '../components/TransactionsView';
import { CategoryColorProvider } from '../CategoryColorContext';
import { getSuggestions } from '../api/recurring';

jest.mock('../api/recurring');

const template = (overrides) => ({
  id: 1, date: '2026-04-02', vendor: 'Anthropic', category: 'Subscriptions', amount: -20, notes: '',
  next_date: '2026-11-03', last_date: '2026-10-03', frequency: 1, frequency_unit: 'months',
  number: -1, idx: 8, suggestion_count: 0, needs_attention: false, ...overrides,
});

const handlers = () => ({
  onEditRecurring: jest.fn(), onLinkToRecurring: jest.fn(), onDismissSuggestion: jest.fn(), onDelete: jest.fn(),
});

const renderTab = (recurring, given = {}) => {
  const props = { ...handlers(), ...given };
  render(
    <RecurringTab
      transactions={[]} accounts={[{ id: 1, account_name: 'Discover' }]} recurringTransactions={recurring}
      onAdd={jest.fn()} onAddRecurring={jest.fn()} onEdit={jest.fn()} onDeleteMany={jest.fn()}
      onToggleTransfer={jest.fn()} onToggleTransferMany={jest.fn()} onDeleteRecurring={jest.fn()}
      {...props}
    />
  );
  return props;
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
  const { onEditRecurring } = renderTab([template({ frequency: 30, frequency_unit: 'days' })],
                                        { onEditRecurring: jest.fn().mockResolvedValue() });
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }));

  const repeats = screen.getByLabelText('Repeats');
  expect(optionLabels(repeats)).toEqual(['Choose a schedule', 'Weekly', 'Biweekly', 'Monthly', 'Quarterly', 'Annually']);
  expect(repeats).toHaveDisplayValue('Choose a schedule');
  expect(within(repeats).getByRole('option', { name: 'Choose a schedule' })).toBeDisabled();

  await userEvent.selectOptions(repeats, 'Monthly');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onEditRecurring).toHaveBeenCalledWith(1, expect.objectContaining({ frequency: 1, frequency_unit: 'months' }));
});

// ── Needs attention and suggestions ──────────────────────────────────────────

const tx = (id, date, overrides) => ({ id, date, vendor: 'ASPIRE', category: 'Loan', amount: -75, ...overrides });

const SUGGESTIONS = [
  { date: '2026-08-31', kind: 'history', linked: [], candidates: [tx(11, '2026-08-31')] },
  { date: '2026-09-30', kind: 'history', linked: [], candidates: [tx(12, '2026-09-30'), tx(13, '2026-10-01', { amount: -45 })] },
  { date: '2026-10-31', kind: 'duplicate', linked: [tx(20, '2026-10-31')], candidates: [tx(14, '2026-11-01')] },
];

const aspire = (overrides) => template({
  id: 5, vendor: 'ASPIRE', category: 'Loan', amount: -75, suggestion_count: 4, needs_attention: true, ...overrides,
});

const openSuggestions = async () => {
  getSuggestions.mockResolvedValue(SUGGESTIONS);
  await userEvent.click(screen.getByRole('button', { name: /4 suggested transactions to review/ }));
  await screen.findByText('Aug 31, 2026');
};

const rowFor = (dateLabel) => screen.getByText(dateLabel).closest('.recurring-suggestion-row');

test('a template that needs attention is badged and offers its suggestions', () => {
  renderTab([aspire(), template({ id: 2, vendor: 'Quiet' })]);
  const flagged = screen.getByText('ASPIRE').closest('.recurring-item');
  expect(within(flagged).getByText('Needs attention')).toHaveClass('needs-attention-badge');
  const quiet = screen.getByText('Quiet').closest('.recurring-item');
  expect(within(quiet).queryByText('Needs attention')).not.toBeInTheDocument();
  expect(within(quiet).queryByRole('button', { name: /suggested/ })).not.toBeInTheDocument();
});

test('each suggestion can be linked or dismissed', async () => {
  const { onLinkToRecurring, onDismissSuggestion } = renderTab([aspire()]);
  await openSuggestions();
  expect(getSuggestions).toHaveBeenCalledWith(5);
  expect(screen.getAllByText(/Before this series started/)).toHaveLength(2);

  await userEvent.click(within(rowFor('Aug 31, 2026')).getByRole('button', { name: 'Link' }));
  expect(onLinkToRecurring).toHaveBeenCalledWith(5, [11]);
  await userEvent.click(within(rowFor('Sep 30, 2026')).getByRole('button', { name: 'Not part of this' }));
  expect(onDismissSuggestion).toHaveBeenCalledWith(5, 12);
});

test('a possible duplicate shows the series row and can be deleted, not linked', async () => {
  const { onDelete, onDismissSuggestion } = renderTab([aspire()]);
  await openSuggestions();
  expect(screen.getByText(/In the series:/)).toHaveTextContent('Oct 31, 2026');

  const copy = rowFor('Nov 1, 2026');
  expect(within(copy).queryByRole('button', { name: 'Link' })).not.toBeInTheDocument();
  await userEvent.click(within(copy).getByRole('button', { name: 'Delete this copy' }));
  expect(onDelete).toHaveBeenCalledWith(14);
  await userEvent.click(within(copy).getByRole('button', { name: 'Not a duplicate' }));
  expect(onDismissSuggestion).toHaveBeenCalledWith(5, 14);
});

test('link all links every suggestion except duplicates, after confirming', async () => {
  const { onLinkToRecurring } = renderTab([aspire()]);
  await openSuggestions();
  const confirm = jest.spyOn(window, 'confirm');

  confirm.mockReturnValueOnce(false);
  await userEvent.click(screen.getByRole('button', { name: 'Link all 3' }));
  expect(onLinkToRecurring).not.toHaveBeenCalled();

  confirm.mockReturnValueOnce(true);
  await userEvent.click(screen.getByRole('button', { name: 'Link all 3' }));
  expect(onLinkToRecurring).toHaveBeenCalledWith(5, [11, 12, 13]);
  confirm.mockRestore();
});

test('the Recurring tab counts templates that need attention', () => {
  render(
    <CategoryColorProvider>
      <TransactionsView
        transactions={[]} accounts={[]}
        recurringTransactions={[aspire(), aspire({ id: 6, vendor: 'Allina' }), template({ id: 7 })]}
      />
    </CategoryColorProvider>
  );
  const tab = screen.getByRole('button', { name: /^Recurring/ });
  expect(within(tab).getByText('2')).toHaveClass('attention-badge');
});
