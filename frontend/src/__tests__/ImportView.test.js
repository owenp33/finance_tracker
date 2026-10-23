import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ImportView from '../components/ImportView';
import { previewImport } from '../api/imports';

jest.mock('../api/imports');

const previewRow = (overrides) => ({
  date: '2025-01-15', vendor: 'Grocer', category: 'Groceries', amount: -5, notes: '',
  account_id: 1, account_name: 'Checking', duplicate: false, zero_amount: false,
  invalid_date: false, is_transfer: false, ...overrides,
});

const showPreview = async (rows, summary) => {
  previewImport.mockResolvedValue({ rows, summary });
  const { container } = render(
    <ImportView accounts={[{ id: 1, account_name: 'Checking' }]} onImportDone={jest.fn()} onNavigateAway={jest.fn()} />
  );
  await userEvent.upload(container.querySelector('input[type="file"]'), new File(['x'], 'bank.csv', { type: 'text/csv' }));
  await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
};

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

test('a blank date is shown as missing', async () => {
  await showPreview(
    [previewRow({ vendor: 'No date', date: '', invalid_date: true })],
    { total: 1, importable: 0, duplicates: 0, unmatched: 0, zero_amount: 0, invalid_date: 1 },
  );

  const row = (await screen.findByText('No date')).closest('tr');
  expect(within(row).getByText('missing')).toHaveClass('csv-warning');
});
