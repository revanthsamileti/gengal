import { Platform } from 'react-native';

type DebugLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * No `phone` here on purpose. Diagnosing a sign-in failure needs to identify a
 * session, not a subscriber, and the number was being transmitted to an
 * unauthenticated endpoint that appended it to a plaintext file. `sessionId`
 * already ties a run of events together.
 */
type DebugContext = {
  userId?: string | null;
  screen?: string | null;
};

type DebugDetails = Record<string, unknown>;

const DEBUG_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const context: DebugContext = {};

const normalizeError = (value: unknown) => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (typeof value === 'string') return { message: value };
  return value;
};

export const setDebugContext = (nextContext: DebugContext) => {
  Object.assign(context, nextContext);
};

export const getDebugSessionId = () => sessionId;

export const logDebugEvent = (
  event: string,
  details: DebugDetails = {},
  level: DebugLevel = 'info',
) => {
  if (!DEBUG_BACKEND_URL) return;
  const payload = {
    level,
    event,
    sessionId,
    platform: Platform.OS,
    ...context,
    details: {
      ...details,
      error: details.error ? normalizeError(details.error) : undefined,
      clientTimestamp: new Date().toISOString(),
    },
  };

  fetch(`${DEBUG_BACKEND_URL.replace(/\/$/, '')}/api/v1/debug/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});
};
