import { fetchAPI, uploadFile, SESSION_EXPIRED_EVENT } from '../api/client';

const respond = (status, body) =>
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: status < 400, status, json: async () => body });

let heard;
const listen = (e) => heard.push(e.detail);

beforeEach(() => {
  heard = [];
  window.addEventListener(SESSION_EXPIRED_EVENT, listen);
});
afterEach(() => {
  window.removeEventListener(SESSION_EXPIRED_EVENT, listen);
  jest.restoreAllMocks();
});

const EXPIRED = 'Your session has expired. Please log in again.';

test('a 401 on a protected request announces that the session ended', async () => {
  respond(401, { success: false, error: EXPIRED });
  await expect(fetchAPI('/api/accounts')).rejects.toThrow(EXPIRED);
  expect(heard).toEqual([EXPIRED]);
});

test('a wrong password on the login form is just an error', async () => {
  respond(401, { success: false, error: 'Invalid credentials' });
  await expect(fetchAPI('/api/auth/login', { method: 'POST' })).rejects.toThrow('Invalid credentials');
  expect(heard).toEqual([]);
});

test('other failures are just errors', async () => {
  respond(500, { success: false, error: 'Internal server error' });
  await expect(fetchAPI('/api/accounts')).rejects.toThrow('Internal server error');
  expect(heard).toEqual([]);
});

test('uploads announce an ended session too', async () => {
  respond(401, { success: false, error: EXPIRED });
  await expect(uploadFile('/api/import/preview', new File(['x'], 'a.csv'))).rejects.toThrow(EXPIRED);
  expect(heard).toEqual([EXPIRED]);
});
