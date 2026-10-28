import { render, screen } from '@testing-library/react';
import FilterPanel from '../components/FilterPanel';

const panel = (props) => (
  <FilterPanel
    accounts={[{ id: 1, account_name: 'Checking' }]} selectedAccountIds={new Set()}
    onAccountToggle={jest.fn()} onAccountSelectAll={jest.fn()} onAccountClear={jest.fn()}
    onStartDateChange={jest.fn()} onEndDateChange={jest.fn()} onDateClear={jest.fn()} onClearAll={jest.fn()}
    {...props}
  />
);

test('the category section shows only when categories are passed', () => {
  const { rerender } = render(panel());
  expect(screen.queryByText('Category')).not.toBeInTheDocument();

  rerender(panel({
    allCategories: ['Groceries'], selectedCategories: new Set(['Groceries']),
    onCategoryToggle: jest.fn(), onCategorySelectAll: jest.fn(), onCategoryClear: jest.fn(),
  }));
  expect(screen.getByText('Category')).toBeInTheDocument();
  expect(screen.getByLabelText('Groceries')).toBeChecked();
});
