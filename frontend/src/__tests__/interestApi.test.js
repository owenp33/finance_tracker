import { getInterest, updateInterest } from '../api/interest';
import { fetchAPI } from '../api/client';

jest.mock('../api/client');

test("the user's interest hits come from GET /api/interest", async () => {
  const hit = { id: 3, account_id: 16, date: '2026-12-01', amount: -419.96, amount_cents: -41996 };
  fetchAPI.mockResolvedValue({ success: true, interest: [hit] });
  await expect(getInterest()).resolves.toEqual([hit]);
  expect(fetchAPI).toHaveBeenCalledWith('/api/interest');
});

test("a hit is changed to the bank's figure, in dollars", async () => {
  fetchAPI.mockResolvedValue({ success: true, interest: { id: 3, amount_cents: -42510 }, account: {} });
  await expect(updateInterest(3, 425.1)).resolves.toEqual({ id: 3, amount_cents: -42510 });
  expect(fetchAPI).toHaveBeenCalledWith('/api/interest/3', { method: 'PATCH', body: JSON.stringify({ amount: 425.1 }) });
});
