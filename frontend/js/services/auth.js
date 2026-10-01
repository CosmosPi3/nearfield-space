const TOKEN_STORAGE_KEY = 'nearfield.sessionToken';

const BASE = (() => {
  const { hostname } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return '/api';
  return 'https://api.nearfield.space/api';
})();

export function getToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

// Resolves the current session (if any) against the backend — the token in
// localStorage might be stale (session deleted server-side, DB reset, etc.),
// so this is the source of truth for "is this user actually signed in",
// not just "is there a token sitting in storage".
export async function restoreSession() {
  const token = getToken();
  if (!token) return null;
  const res = await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    return null;
  }
  const { user } = await res.json();
  return user;
}

export async function loginWithGoogleIdToken(idToken) {
  const res = await fetch(`${BASE}/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) throw new Error('Google sign-in failed');
  const { token, user } = await res.json();
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
  return user;
}

export async function updateDisplayName(displayName) {
  const res = await fetch(`${BASE}/auth/display-name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ displayName }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || 'Could not update display name');
  }
  const { user } = await res.json();
  return user;
}

export async function logout() {
  const token = getToken();
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  if (!token) return;
  await fetch(`${BASE}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
}
