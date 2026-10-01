import { loginWithGoogleIdToken } from '../services/auth.js';
import { GOOGLE_CLIENT_ID } from '../config.js';

let gisLoadPromise = null;
function loadGoogleIdentityScript() {
  if (gisLoadPromise) return gisLoadPromise;
  gisLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

// Shows the full-screen sign-in gate and resolves once the user has
// successfully authenticated with Google -- callers must not mount the rest
// of the app until this returns, since sign-in is required to use the site
// at all (see backend/server.js's requireAuth gate on every /api/* route).
export async function showAuthGate({ overlayEl, buttonContainerEl, statusEl }) {
  await loadGoogleIdentityScript();
  overlayEl.classList.remove('hidden');

  return new Promise((resolve) => {
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async ({ credential }) => {
        statusEl.textContent = 'Signing in…';
        try {
          const user = await loginWithGoogleIdToken(credential);
          overlayEl.classList.add('hidden');
          resolve(user);
        } catch (err) {
          statusEl.textContent = 'Sign-in failed — please try again.';
        }
      },
    });
    window.google.accounts.id.renderButton(buttonContainerEl, { theme: 'filled_blue', size: 'large', shape: 'pill' });
  });
}
