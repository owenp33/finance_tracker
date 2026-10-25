import { getSuggestions, linkToRecurring, unlinkFromRecurring, dismissSuggestion } from '../api/recurring';
import { fetchAPI } from '../api/client';

jest.mock('../api/client');

beforeEach(() => fetchAPI.mockResolvedValue({ suggestions: [], recurring: {} }));

test("a template's suggestions are fetched from its own endpoint", async () => {
  fetchAPI.mockResolvedValue({ suggestions: ['one'] });
  expect(await getSuggestions(7)).toEqual(['one']);
  expect(fetchAPI).toHaveBeenCalledWith('/api/recurring/7/suggestions');
});

test('linking and dismissing post to the template', () => {
  linkToRecurring(7, 42);
  expect(fetchAPI).toHaveBeenLastCalledWith('/api/recurring/7/transactions/42', { method: 'POST' });
  dismissSuggestion(7, 42);
  expect(fetchAPI).toHaveBeenLastCalledWith('/api/recurring/7/dismissals/42', { method: 'POST' });
});

test('removing from a series deletes the link', () => {
  unlinkFromRecurring(7, 42);
  expect(fetchAPI).toHaveBeenLastCalledWith('/api/recurring/7/transactions/42', { method: 'DELETE' });
});
