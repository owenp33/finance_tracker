const API_BASE = process.env.REACT_APP_API_URL || '';

// Fired on window when a protected request answers 401 (login missing, expired, or invalid);
// detail is the server's message. App listens and returns to the login screen.
export const SESSION_EXPIRED_EVENT = 'session-expired';

// The Error to throw for a failed response, announcing an ended session when that's the cause
const failure = async (response, fallback, isLoginRequest = false) => {
  const errorData = await response.json().catch(() => ({}));
  const message = errorData.error || fallback;
  if (response.status === 401 && !isLoginRequest) {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: message }));
  }
  return new Error(message);
};

export const fetchAPI = async (endpoint, options = {}) => {
  const token = localStorage.getItem('token');

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const skipAuth = endpoint === '/api/auth/login' || endpoint === '/api/auth/register';
  if (token && !skipAuth) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) throw await failure(response, 'Request failed', skipAuth);

  return response.json();
};

export const uploadFile = async (endpoint, file, extraFields = {}) => {
  const token = localStorage.getItem('token');
  const formData = new FormData();
  formData.append('file', file);
  Object.entries(extraFields).forEach(([k, v]) => formData.append(k, v));

  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData,
  });

  if (!response.ok) throw await failure(response, 'Upload failed');

  return response.json();
};

const saveBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// Has the browser save the response under the server's filename (Content-Disposition), else fallbackName
export const downloadFile = async (endpoint, fallbackName) => {
  const token = localStorage.getItem('token');
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
  });

  if (!response.ok) throw await failure(response, 'Download failed');

  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/);
  saveBlob(await response.blob(), match ? match[1] : fallbackName);
};