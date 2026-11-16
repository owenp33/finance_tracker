import { createAccount, updateFromStatement } from '../api/accounts';
import { fetchAPI } from '../api/client';

jest.mock('../api/client');

test('an account is created from its fields, a loan with its kind and APR', async () => {
  fetchAPI.mockResolvedValue({ success: true, account: { id: 9 } });
  const fields = { account_id: 'aspire-1', account_name: 'ASPIRE loan', kind: 'loan', apr: 6.8 };
  await expect(createAccount(fields)).resolves.toEqual({ id: 9 });
  expect(fetchAPI).toHaveBeenCalledWith('/api/accounts', { method: 'POST', body: JSON.stringify(fields) });
});

test("a statement is posted to the loan's account, and its account and adjustment come back", async () => {
  const adjustment = { id: 40, date: '2026-02-28', amount_cents: -5000 };
  fetchAPI.mockResolvedValue({ success: true, account: { id: 5, balance: -19900 }, adjustment });
  await expect(updateFromStatement(5, { date: '2026-02-28', balance: -19900 }))
    .resolves.toEqual({ account: { id: 5, balance: -19900 }, adjustment });
  expect(fetchAPI).toHaveBeenCalledWith('/api/accounts/5/statement', {
    method: 'POST',
    body: JSON.stringify({ date: '2026-02-28', balance: -19900 }),
  });
});
