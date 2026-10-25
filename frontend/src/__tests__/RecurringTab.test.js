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
    <CategoryColorProvider>
      <RecurringTab
        transactions={[]} accounts={[{ id: 1, account_name: 'Discover' }]} recurringTransactions={recurring}
        onAdd={jest.fn()} onAddRecurring={jest.fn()} onEdit={jest.fn()} onDeleteMany={jest.fn()}
        onToggleTransfer={jest.fn()} onToggleTransferMany={jest.fn()} onDeleteRecurring={jest.fn()}
        {...props}
      />
    </CategoryColorProvider>
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
  await screen.findAllByText(/Before this series started/);
};

// Suggestion rows look like the generated transactions: "<category> · <date>"
const rowFor = (detail) => screen.getByText(detail).closest('.transaction-item');

test('a template that needs attention is badged and offers its suggestions', () => {
  renderTab([aspire(), template({ id: 2, vendor: 'Quiet' })]);
  const flagged = screen.getByText('ASPIRE').closest('.recurring-item');
  expect(within(flagged).getByText('Needs attention')).toHaveClass('needs-attention-badge');
  const quiet = screen.getByText('Quiet').closest('.recurring-item');
  expect(within(quiet).queryByText('Needs attention')).not.toBeInTheDocument();
  expect(within(quiet).queryByRole('button', { name: /suggested/ })).not.toBeInTheDocument();
});

test('each suggestion can be linked or marked unrelated', async () => {
  const { onLinkToRecurring, onDismissSuggestion } = renderTab([aspire()]);
  await openSuggestions();
  expect(getSuggestions).toHaveBeenCalledWith(5);
  expect(screen.getByText('Aug 31, 2026 · Before this series started')).toBeInTheDocument();

  const august = rowFor('Loan · Aug 31');
  expect(within(august).queryByRole('button', { name: 'Delete duplicate' })).not.toBeInTheDocument();
  await userEvent.click(within(august).getByRole('button', { name: 'Link to series' }));
  expect(onLinkToRecurring).toHaveBeenCalledWith(5, [11]);
  await userEvent.click(within(rowFor('Loan · Sep 30')).getByRole('button', { name: 'Unrelated transaction' }));
  expect(onDismissSuggestion).toHaveBeenCalledWith(5, 12);
});

test('a possible duplicate shows the conflicting series row and can be linked, marked unrelated, or deleted', async () => {
  const { onLinkToRecurring, onDelete, onDismissSuggestion } = renderTab([aspire()]);
  await openSuggestions();
  expect(screen.getByText('Oct 31, 2026 · Possible duplicate or unrelated transaction')).toBeInTheDocument();

  const inSeries = rowFor('Loan · Oct 31');
  expect(inSeries.closest('.recurring-suggestion-series')).toHaveTextContent('In the series');
  expect(within(inSeries).queryAllByRole('button')).toHaveLength(0);

  const copy = rowFor('Loan · Nov 1');
  await userEvent.click(within(copy).getByRole('button', { name: 'Link to series' }));
  expect(onLinkToRecurring).toHaveBeenCalledWith(5, [14]);
  await userEvent.click(within(copy).getByRole('button', { name: 'Unrelated transaction' }));
  expect(onDismissSuggestion).toHaveBeenCalledWith(5, 14);
  await userEvent.click(within(copy).getByRole('button', { name: 'Delete duplicate' }));
  expect(onDelete).toHaveBeenCalledWith(14);
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

test('the All tab marks unrelated transactions and adds them back to their series', async () => {
  const onLinkToRecurring = jest.fn();
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;   // in the default month
  render(
    <CategoryColorProvider>
      <TransactionsView
        transactions={[{ id: 496, date, vendor: 'ASPIRE', category: 'Loan', amount: -60, account_id: 1 }]}
        accounts={[{ id: 1, account_name: 'Checking' }]}
        recurringTransactions={[aspire({ dismissed_transaction_ids: [496] })]}
        onLinkToRecurring={onLinkToRecurring}
      />
    </CategoryColorProvider>
  );
  expect(screen.getByText('Unrelated')).toHaveAttribute('title', 'Marked unrelated to ASPIRE');
  await userEvent.click(screen.getByRole('button', { name: 'Add to ASPIRE series' }));
  expect(onLinkToRecurring).toHaveBeenCalledWith(5, [496]);
});
