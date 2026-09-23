import { auth } from '../config/firebase';

import { Platform } from 'react-native';
import { logDebugEvent, setDebugContext } from './debugLogger';

export const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const SESSION_PHONE_KEY = 'gengal.session.phone';

/**
 * EXPO_PUBLIC_* values are inlined at bundle time, so whatever is set when a
 * build is made is baked into the binary permanently. Development tunnels are
 * rotated or torn down, which silently bricks every install pointing at them.
 */
const EPHEMERAL_TUNNEL_HOSTS = [
  'trycloudflare.com',
  'ngrok.io',
  'ngrok-free.app',
  'loca.lt',
  'serveo.net',
  'pinggy.link',
];

let warnedAboutTunnel = false;

const warnIfEphemeral = (url: string) => {
  if (warnedAboutTunnel || __DEV__) return;
  if (EPHEMERAL_TUNNEL_HOSTS.some(host => url.includes(host))) {
    warnedAboutTunnel = true;
    console.warn(
      `[Auth] EXPO_PUBLIC_BACKEND_URL points at a temporary tunnel (${url}). ` +
      'This build will stop working when the tunnel closes — set a stable HTTPS backend URL before releasing.'
    );
  }
};

export const getBackendUrl = () => {
  if (!BACKEND_URL) {
    throw new Error('Missing EXPO_PUBLIC_BACKEND_URL. Configure a production HTTPS backend URL before running the app.');
  }
  const url = BACKEND_URL.replace(/\/$/, '');
  warnIfEphemeral(url);
  return url;
};

const safeParseJson = async (response: Response, defaultError: string): Promise<any> => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(
      `${defaultError} (Server offline or returned non-JSON format: ${text.substring(0, 100)}...)`
    );
  }
};

const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const AUTH_MAX_ATTEMPTS = 3;

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries transient network / gateway failures a couple of times. On a flaky
 * mobile link a single dropped handshake used to fail token mint, billing
 * ticks, and call setup even though the next attempt would succeed.
 * 4xx responses are never retried (they are authoritative).
 */
async function withAuthRetry<T>(
  path: string,
  execute: () => Promise<Response>,
  attachErrorFields?: (error: Error, data: any) => void,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= AUTH_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await execute();
      const data = await safeParseJson(response, `Request to ${path} failed`);
      if (!response.ok) {
        if (isRetryableStatus(response.status) && attempt < AUTH_MAX_ATTEMPTS) {
          await sleep(400 * attempt);
          continue;
        }
        const error = new Error(data.error || `Request to ${path} failed`);
        (error as any).status = response.status;
        attachErrorFields?.(error, data);
        throw error;
      }
      return data as T;
    } catch (e: any) {
      lastError = e;
      // Auth / validation errors must not be retried.
      if (e?.status && e.status < 500) throw e;
      if (attempt >= AUTH_MAX_ATTEMPTS) throw e;
      await sleep(400 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Request to ${path} failed`);
}

/** POSTs to the backend with the caller's Firebase ID token attached. */
export const authedPost = async <T>(path: string, body: Record<string, unknown> = {}): Promise<T> => {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be logged in.');

  const idToken = await user.getIdToken();
  const url = `${getBackendUrl()}${path}`;

  return withAuthRetry(
    path,
    () =>
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(body),
      }),
    (error, data) => {
      (error as any).code = data.code;
    },
  );
};

export const authedGet = async <T>(path: string): Promise<T> => {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be logged in.');

  const idToken = await user.getIdToken();
  const url = `${getBackendUrl()}${path}`;

  return withAuthRetry(path, () =>
    fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
    }),
  );
};

const secureDelete = async (key: string) => {
  if (Platform.OS === 'web') return;
  try {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.deleteItemAsync(key);
  } catch {}
};

export const clearAuthSession = async () => {
  await secureDelete(SESSION_PHONE_KEY);
};

export const checkUsernameAvailable = async (username: string, excludeUid?: string): Promise<boolean> => {
  const response = await fetch(`${getBackendUrl()}/api/v1/auth/check-username`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username.trim().toLowerCase(), excludeUid }),
  });

  if (!response.ok) {
    const data = await safeParseJson(response, 'Failed to check username');
    throw new Error(data.error || 'Failed to check username');
  }

  const data = await safeParseJson(response, 'Failed to check username');
  return data.available;
};

export const purgeAccountData = async () => {
  await authedPost('/api/v1/auth/delete-account');
};

export const logout = async () => {
  try {
    logDebugEvent('auth.logout.start', {});
    const uid = auth.currentUser?.uid;
    if (uid) {
      // Must happen while still signed in: the rules only let an account write
      // its own records. Bounded, because Firestore holds a write until the
      // server acknowledges it, and an offline phone must still be able to
      // sign out.
      const { markSignedOut } = await import('./userService');
      await Promise.race([
        markSignedOut(uid).catch((e) => console.warn('[Auth] Could not mark signed out:', e)),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    }
    await clearAuthSession();
    await auth.signOut();
    setDebugContext({ userId: null });
    logDebugEvent('auth.logout.success', {});
  } catch (error) {
    logDebugEvent('auth.logout.failed', { error }, 'error');
    console.error("Error logging out", error);
    throw error;
  }
};
