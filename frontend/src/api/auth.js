import { fetchAPI } from './client';

export const login = (username, password) =>
  fetchAPI('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

export const register = (username, email, password) =>
  fetchAPI('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, email, password }),
  });

export const me = () => fetchAPI('/api/auth/me');
