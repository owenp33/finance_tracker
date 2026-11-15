import { getBalances } from '../api/balances';
import { fetchAPI } from '../api/client';

jest.mock('../api/client');

test("loads every account's balances over all time", async () => {
  fetchAPI.mockResolvedValue({ success: true, balances: ['one'] });
  expect(await getBalances()).toEqual(['one']);
  expect(fetchAPI).toHaveBeenLastCalledWith('/api/balances');
});
