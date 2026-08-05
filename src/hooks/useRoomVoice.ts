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
 */
export function useRoomVoice(roomId: string | undefined, role: VoiceRole, enabled = true) {
  const voice = useGengalVoice('agora');
  const { connectSeat, disconnectSeat, changeRole } = voice;

  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read at connect time so a role change before the token lands is not lost.
  const roleRef = useRef<VoiceRole>(role);
  roleRef.current = role;

  useEffect(() => {
    if (!roomId || !enabled) return;

    let active = true;
    (async () => {
      try {
        const creds = await authedPost<{ token: string; uid?: number }>(
          '/api/v1/agora/generate-token',
          { roomId }
        );
        if (!active) return;

        await connectSeat(
          roomId,
          creds.token,
          creds.uid != null ? String(creds.uid) : undefined,
          roleRef.current
        );
        if (!active) return;
        setConnected(true);
        setError(null);
      } catch (e: any) {
        if (!active) return;
        setConnected(false);
        // Voice is best-effort: a room stays usable without it, so surface the
        // reason rather than throwing into an unhandled rejection.
        setError(e?.message ?? 'Voice is unavailable right now.');
        console.warn('[RoomVoice] Could not join voice:', e?.message ?? e);
      }
    })();

    return () => {
      active = false;
      setConnected(false);
      disconnectSeat();
    };
    // connectSeat/disconnectSeat are re-created each render by useGengalVoice;
    // including them would tear the channel down on every paint.
  }, [roomId, enabled]);

  // Promote/demote once the channel is live.
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
