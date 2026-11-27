import { fetchAPI, uploadFile, downloadFile, SESSION_EXPIRED_EVENT } from '../api/client';

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

describe('downloadFile', () => {
  let saved;   // the file name of each download the browser was asked to save

  const serve = (disposition) => jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true, status: 200, blob: async () => new Blob(['x']), headers: { get: () => disposition },
  });

  beforeEach(() => {
    saved = [];
    URL.createObjectURL = jest.fn(() => 'blob:download');
    URL.revokeObjectURL = jest.fn();
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function save() { saved.push(this.download); });
  });
  afterEach(() => localStorage.removeItem('token'));

  test('saves the file under the name the server gives, sending the token', async () => {
    localStorage.setItem('token', 'abc');
    serve('attachment; filename=report.pdf');
    await downloadFile('/api/export/report.pdf', 'fallback.pdf');
    expect(fetch).toHaveBeenCalledWith('/api/export/report.pdf', { headers: { Authorization: 'Bearer abc' } });
    expect(saved).toEqual(['report.pdf']);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:download');
  });

  test('falls back to the given name', async () => {
    serve(null);
    await downloadFile('/api/export/report.pdf', 'fallback.pdf');
    expect(saved).toEqual(['fallback.pdf']);
  });

  test('a 401 announces that the session ended', async () => {
    respond(401, { success: false, error: EXPIRED });
    await expect(downloadFile('/api/export/report.pdf', 'report.pdf')).rejects.toThrow(EXPIRED);
    expect(heard).toEqual([EXPIRED]);
    expect(saved).toEqual([]);
  });

  test('other failures are just errors', async () => {
    respond(400, { success: false, error: 'No transactions in this period.' });
    await expect(downloadFile('/api/export/report.pdf', 'report.pdf')).rejects.toThrow('No transactions in this period.');
    expect(heard).toEqual([]);
  });
});
