import { setScheduledPace } from '../api/budgets';
import { fetchAPI } from '../api/client';

jest.mock('../api/client');

test("a category's pace is put by name", async () => {
  fetchAPI.mockResolvedValue({ success: true, category: 'Subscriptions', scheduled: true });
  await setScheduledPace('Subscriptions', true);
  expect(fetchAPI).toHaveBeenCalledWith('/api/budgets/scheduled-pace', {
    method: 'PUT',
    body: JSON.stringify({ category: 'Subscriptions', scheduled: true }),
  });
});
