import { createAccount } from '../api/accounts';
import { fetchAPI } from '../api/client';

jest.mock('../api/client');

test('an account is created from its fields, a loan with its kind and APR', async () => {
  fetchAPI.mockResolvedValue({ success: true, account: { id: 9 } });
  const fields = { account_id: 'aspire-1', account_name: 'ASPIRE loan', kind: 'loan', apr: 6.8 };
  await expect(createAccount(fields)).resolves.toEqual({ id: 9 });
  expect(fetchAPI).toHaveBeenCalledWith('/api/accounts', { method: 'POST', body: JSON.stringify(fields) });
});
