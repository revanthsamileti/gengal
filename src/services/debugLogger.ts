import { Platform } from 'react-native';

type DebugLevel = 'debug' | 'info' | 'warn' | 'error';

type DebugContext = {
  userId?: string | null;
  phone?: string | null;
  screen?: string | null;
};

type DebugDetails = Record<string, unknown>;

const DEBUG_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://127.0.0.1:5000';
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

  fetch(`${DEBUG_BACKEND_URL}/api/v1/debug/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});
};

