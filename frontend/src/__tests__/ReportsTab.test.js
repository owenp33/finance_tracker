import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportsTab from '../components/insights/ReportsTab';
import { exportTransactionsCSV, exportReportPDF } from '../api/export';

jest.mock('../api/export');

const accounts = [{ id: 1, account_name: 'Checking' }, { id: 2, account_name: 'Savings' }];

test('there is no category filter', () => {
  render(<ReportsTab accounts={accounts} />);
  expect(screen.getByText('Account')).toBeInTheDocument();
  expect(screen.queryByText('Category')).not.toBeInTheDocument();
});

test('a download sends the chosen accounts and period', async () => {
  exportTransactionsCSV.mockResolvedValue();
  const { container } = render(<ReportsTab accounts={accounts} />);

  await userEvent.click(screen.getByLabelText('Savings'));
  fireEvent.change(container.querySelector('input[type="date"]'), { target: { value: '2026-01-01' } });
  await userEvent.click(screen.getByRole('button', { name: 'Export Transactions CSV' }));

  expect(exportTransactionsCSV).toHaveBeenCalledWith({ accountIds: [2], startDate: '2026-01-01', endDate: undefined });
});

test('a refused download says why', async () => {
  exportReportPDF.mockRejectedValue(new Error('No transactions in this period.'));
  render(<ReportsTab accounts={accounts} />);

  await userEvent.click(screen.getByRole('button', { name: 'Download PDF' }));

  expect(await screen.findByText('No transactions in this period.')).toHaveClass('error-message');
});
