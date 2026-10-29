import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuthScreen from '../components/AuthScreen';

const renderScreen = () => {
  const handlers = { onLogin: jest.fn(), onRegister: jest.fn() };
  const { container } = render(<AuthScreen {...handlers} />);
  const passwordInput = () => container.querySelector('input[type="password"]');
  return { ...handlers, passwordInput };
};

const switchToRegister = () => userEvent.click(screen.getByRole('button', { name: 'Register' }));

test('login form does not apply the registration password rule', () => {
  const { passwordInput } = renderScreen();
  expect(passwordInput()).not.toHaveAttribute('minLength');
  expect(screen.queryByText(/at least 8 characters/i)).not.toBeInTheDocument();
});

test('register form shows the password rule and has the browser enforce it', async () => {
  const { passwordInput } = renderScreen();
  await switchToRegister();

  expect(screen.getByText('(at least 8 characters)')).toBeInTheDocument();
  // Browsers block submitting below minLength; jsdom doesn't implement that check, so pin the attribute
  expect(passwordInput()).toHaveAttribute('minLength', '8');
});

test('register form submits once the password is long enough', async () => {
  const { passwordInput, onRegister } = renderScreen();
  await switchToRegister();

  const [username, email] = screen.getAllByRole('textbox');
  await userEvent.type(username, 'newuser');
  await userEvent.type(email, 'new@example.com');
  await userEvent.type(passwordInput(), 'long-enough');
  await userEvent.click(screen.getByRole('button', { name: 'Register' }));

  expect(onRegister).toHaveBeenCalledWith('newuser', 'new@example.com', 'long-enough');
});
