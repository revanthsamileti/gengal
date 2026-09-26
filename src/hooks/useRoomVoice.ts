import { useEffect, useRef, useState } from 'react';
import { useGengalVoice } from './useGengalVoice';
import { authedPost } from '../services/authService';

export type VoiceRole = 'broadcaster' | 'audience';

/**
 * Voice for a multi-party room, in one place.
 *
 * Every room screen used to wire this up itself and each got it wrong in a
 * different way: ExpertRoom sent an unauthenticated fetch (the token endpoint
 * requires a bearer token, so it 401'd and the room was silent), Ludo passed a
 * made-up string where the token belongs, and DumCharades had no voice at all.
 *
 * The backend derives the Agora uid from the bearer token, so callers must not
 * send one — and must join with the numeric uid it returns, or the token will
 * not match the channel identity.
 *
 * Role changes remint: an audience token cannot publish, so promoting to
 * broadcaster after the host accepts a hand must fetch a publisher token.
 */
export function useRoomVoice(roomId: string | undefined, role: VoiceRole, enabled = true) {
  const voice = useGengalVoice('agora');
  const { connectSeat, disconnectSeat, changeRole } = voice;

  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roleRef = useRef<VoiceRole>(role);
  roleRef.current = role;

  useEffect(() => {
    if (!roomId || !enabled) return;

    let active = true;
    (async () => {
      try {
        const creds = await authedPost<{ token: string; uid?: number; role?: string }>(
          '/api/v1/agora/generate-token',
          { roomId, role: roleRef.current }
        );
        if (!active) return;

        // Server is authoritative; fall back to the requested role if older
        // backends omit the field.
        let granted: VoiceRole = roleRef.current;
        if (creds.role === 'broadcaster' || creds.role === 'audience') {
          granted = creds.role;
        }

        await connectSeat(
          roomId,
          creds.token,
          creds.uid != null ? String(creds.uid) : undefined,
          granted
        );
        if (!active) return;
        setConnected(true);
        setError(null);
      } catch (e: any) {
        if (!active) return;
        setConnected(false);
        setError(e?.message ?? 'Voice is unavailable right now.');
        console.warn('[RoomVoice] Could not join voice:', e?.message ?? e);
      }
    })();

    return () => {
      active = false;
      setConnected(false);
      disconnectSeat();
    };
    // Remint when role flips (stage up / seat buy / chill actor). Including
    // connectSeat would tear the channel down on every paint.
  }, [roomId, enabled, role]);

  // Keep the native client role in sync when already on the right token privilege.
  useEffect(() => {
    if (!connected) return;
    changeRole(role).catch((e) =>
      console.warn('[RoomVoice] Could not switch role:', e?.message ?? e)
    );
  }, [role, connected]);

  return {
    connected,
    error,
    toggleMic: voice.toggleMic,
    micMuted: voice.micMuted,
    toggleSpeaker: voice.toggleSpeaker,
    speakerOn: voice.speakerOn,
    remoteUids: voice.remoteUids,
  };
}
