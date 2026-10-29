import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { CategoryColorProvider } from '../CategoryColorContext';
import { SESSION_EXPIRED_EVENT } from '../api/client';
import { login, me } from '../api/auth';
import { getAccounts } from '../api/accounts';
import { getAllTransactions } from '../api/transactions';
import { getBudgetProgress } from '../api/budgets';
import { getAnalytics } from '../api/analytics';

jest.mock('../api/auth');
jest.mock('../api/accounts');
jest.mock('../api/transactions');
jest.mock('../api/budgets');
jest.mock('../api/analytics');
jest.mock('../api/recurring');

const EXPIRED = 'Your session has expired. Please log in again.';
const USER = { id: 1, username: 'owen' };

// What the real client does when a request finds the login expired: after the response arrives,
// announce it, then fail
const expireSession = async () => {
  await Promise.resolve();
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: EXPIRED }));
  throw new Error(EXPIRED);
};

beforeEach(() => {
  localStorage.clear();
  me.mockResolvedValue({ user: USER });
  login.mockResolvedValue({ access_token: 'new-token', user: USER, updates: {} });
  getAccounts.mockResolvedValue([]);
  getAllTransactions.mockResolvedValue([]);
  getBudgetProgress.mockResolvedValue([]);
  getAnalytics.mockResolvedValue(null);
});

const renderApp = () => render(<CategoryColorProvider><App /></CategoryColorProvider>);

const logIn = async (password = 'right-password') => {
  const [username] = screen.getAllByRole('textbox');
  const passwordInput = document.querySelector('input[type="password"]');
  await userEvent.clear(username);
  await userEvent.type(username, 'owen');
  await userEvent.clear(passwordInput);
  await userEvent.type(passwordInput, password);
  await userEvent.click(screen.getByRole('button', { name: 'Login' }));
};

const loggedIn = () => screen.findByRole('button', { name: 'Logout' });

test('an expired login explains itself on the login screen, and the message goes once you log in again', async () => {
  localStorage.setItem('token', 'expired-token');
  me.mockImplementation(async () => (localStorage.getItem('token') === 'expired-token' ? expireSession() : { user: USER }));
  renderApp();
  expect(await screen.findByText(EXPIRED)).toBeInTheDocument();

  await logIn();
  await loggedIn();
  expect(screen.queryByText(EXPIRED)).not.toBeInTheDocument();
});

test("a failed login attempt's message goes once the next attempt works", async () => {
  login.mockRejectedValueOnce(new Error('Invalid username or password'));
  renderApp();
  await logIn('wrong-password');
  expect(await screen.findByText('Invalid username or password')).toBeInTheDocument();

  await logIn();
  await loggedIn();
  expect(screen.queryByText('Invalid username or password')).not.toBeInTheDocument();
});

test("logging out leaves the session's messages behind", async () => {
  localStorage.setItem('token', 'good-token');
  getAccounts.mockRejectedValue(new Error('Could not load accounts'));
  renderApp();
  expect(await screen.findByText('Could not load accounts')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Logout' }));
  expect(await screen.findByRole('button', { name: 'Login' })).toBeInTheDocument();
  expect(screen.queryByText('Could not load accounts')).not.toBeInTheDocument();
});

test('a login that expires while you use the app sends you to the login screen, saying why', async () => {
  localStorage.setItem('token', 'good-token');
  renderApp();
  await loggedIn();

  act(() => { window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: EXPIRED })); });
  expect(await screen.findByText(EXPIRED)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument();
});
