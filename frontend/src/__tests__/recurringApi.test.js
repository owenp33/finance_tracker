import {
  getSuggestions, linkToRecurring, unlinkFromRecurring, dismissSuggestion,
  getDetectedSeries, addDetectedSeries, dismissDetectedSeries,
} from '../api/recurring';
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

test('found series are listed, then added or marked not recurring by their payments', async () => {
  fetchAPI.mockResolvedValue({ series: ['one'] });
  expect(await getDetectedSeries()).toEqual(['one']);
  expect(fetchAPI).toHaveBeenLastCalledWith('/api/recurring/detected');

  const body = { method: 'POST', body: JSON.stringify({ transaction_ids: [51, 52] }) };
  fetchAPI.mockResolvedValue({ recurring: { id: 9 } });
  expect(await addDetectedSeries([51, 52])).toEqual({ id: 9 });
  expect(fetchAPI).toHaveBeenLastCalledWith('/api/recurring/detected', body);
  dismissDetectedSeries([51, 52]);
  expect(fetchAPI).toHaveBeenLastCalledWith('/api/recurring/detected/dismissals', body);
});
