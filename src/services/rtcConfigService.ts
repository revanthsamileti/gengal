import { authedGet } from './authService';

/**
 * The Agora App ID must match the one the backend signs tokens with. Hardcoding
 * it in the client meant the two could drift silently, rejecting every token.
 * Fetched once per session and cached.
 */
let cachedAppId: string | null = null;
let inFlight: Promise<string> | null = null;

export const getAgoraAppId = async (): Promise<string> => {
  if (cachedAppId) return cachedAppId;
  if (inFlight) return inFlight;

  inFlight = authedGet<{ agoraAppId: string }>('/api/v1/rtc/config')
    .then(({ agoraAppId }) => {
      if (!agoraAppId) throw new Error('Backend did not return an Agora App ID.');
      cachedAppId = agoraAppId;
      return agoraAppId;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
};

export const resetRtcConfigCache = () => {
  cachedAppId = null;
};
