import { useState, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { getAgoraEngine } from './NativeEngines';
import { logDebugEvent } from '../services/debugLogger';
import { getAgoraAppId } from '../services/rtcConfigService';

/**
 * `zegocloud` is intended but not implemented — `connectSeat` throws for it, so
 * it is deliberately absent from `WATERFALL` in CallScreen. The dyte, daily,
 * videosdk and stream members were removed: nothing ever dispatched on them and
 * their client refs below were never assigned, so the type was advertising
 * support that did not exist anywhere in the codebase.
 */
export type FreeProvider = 'agora' | 'zegocloud';

interface GengalVoiceInterface {
  /**
   * `speakerDefault` controls whether the audio route is set to loudspeaker
   * (true, video-call standard) or earpiece (false, voice-call standard) when
   * the channel join succeeds. Callers pass `isVideo` so voice calls always
   * start on earpiece and video calls start on speaker, matching the behaviour
   * the user expects from any phone app.
   */
  connectSeat: (
    roomId: string,
    tokenOrUrl: string,
    userId?: string,
    role?: 'broadcaster' | 'audience',
    speakerDefault?: boolean
  ) => Promise<any>;
  disconnectSeat: () => Promise<void>;
  changeRole: (role: 'broadcaster' | 'audience') => Promise<void>;
  toggleMic: () => void;
  micMuted: boolean;
  toggleSpeaker: () => void;
  speakerOn: boolean;
  toggleCamera: () => void;
  cameraOn: boolean;
  flipCamera: () => void;
  remoteUids: number[];
  localUid: number | null;
  /**
   * True while Agora's RTC layer is actively attempting to re-establish a
   * dropped connection (ConnectionStateType = RECONNECTING = 4). This is
   * distinct from `isPeerUnstable` in CallScreen, which is heartbeat-based:
   * `isReconnecting` fires immediately on a local network drop, before any
   * heartbeat has timed out.
   */
  isReconnecting: boolean;
}

export function useGengalVoice(provider: FreeProvider): GengalVoiceInterface {
  const [micMuted, setMicMuted] = useState(false);
  // Start with false (earpiece). The connectSeat call sets the correct initial
  // state via speakerDefaultRef + onJoinChannelSuccess, so the UI button label
  // (Speaker / Earpiece) is accurate from the moment the call connects.
  const [speakerOn, setSpeakerOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [remoteUids, setRemoteUids] = useState<number[]>([]);
  const [localUid, setLocalUid] = useState<number | null>(null);
  // Set when Agora reports CONNECTION_STATE_TYPE_RECONNECTING (4). Exposed so
  // CallScreen can show a localised "Reconnecting…" banner that is triggered
  // by the RTC layer directly, not delayed by a heartbeat timeout.
  const [isReconnecting, setIsReconnecting] = useState(false);

  // Safe ref for Agora engine so it doesn't crash the web bundler.
  const agoraEngineRef = useRef<any>(null);

  // Holds the speaker preference requested by the last connectSeat call. Used
  // inside onJoinChannelSuccess — which is registered once during engine init
  // and cannot be re-bound — so the correct audio route is applied at join
  // time rather than at engine-init time (when the mode is unknown).
  const speakerDefaultRef = useRef(false);

  // Engine setup is async now that the App ID comes from the backend, so
  // connectSeat awaits this instead of racing it.
  const agoraReadyRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    // We only initialize Agora if we are not on web (react-native-agora is native only)
    if (provider === 'agora' && Platform.OS !== 'web') {
      agoraReadyRef.current = (async () => {
        try {
          const appId = await getAgoraAppId();
          const { createAgoraRtcEngine } = getAgoraEngine();
          agoraEngineRef.current = createAgoraRtcEngine();
          agoraEngineRef.current.initialize({ appId });
          agoraEngineRef.current.enableAudio();
          agoraEngineRef.current.enableVideo();
          agoraEngineRef.current.startPreview();
          agoraEngineRef.current.registerEventHandler({
            onJoinChannelSuccess: (connection: any, _elapsed: number) => {
              // Apply the audio route that was requested when connectSeat was
              // called. Previously this was hardcoded to speaker=true, so voice
              // calls always started on loudspeaker — the wrong default for a
              // phone-style call where the device is held to the ear.
              const speaker = speakerDefaultRef.current;
              console.log(
                `[Agora Node] Joined channel ${connection.channelId} uid ${connection.localUid}. ` +
                `Audio route: ${speaker ? 'speaker' : 'earpiece'}.`
              );
              agoraEngineRef.current?.setDefaultAudioRouteToSpeakerphone(speaker);
              agoraEngineRef.current?.setEnableSpeakerphone(speaker);
              agoraEngineRef.current?.muteLocalAudioStream(false);
              setSpeakerOn(speaker);
              setLocalUid(connection.localUid ?? 0);
              // Reconnection succeeded (or this is the initial join).
              setIsReconnecting(false);
            },
            onUserJoined: (_connection: any, remoteUid: number, _elapsed: number) => {
              console.log(`[Agora Node] Remote user joined: ${remoteUid}`);
              setRemoteUids((prev) => [...prev, remoteUid]);
            },
            onUserOffline: (_connection: any, remoteUid: number, _reason: any) => {
              console.log(`[Agora Node] Remote user offline: ${remoteUid}`);
              setRemoteUids((prev) => prev.filter((uid) => uid !== remoteUid));
            },
            /**
             * Connection state events from the Agora RTC layer.
             *
             * ConnectionStateType values (from react-native-agora constants):
             *   1 = DISCONNECTED — not yet joined or just left
             *   2 = CONNECTING   — join initiated
             *   3 = CONNECTED    — normal operation
             *   4 = RECONNECTING — network drop; SDK trying to re-join
             *   5 = FAILED       — reconnection gave up (>= 10 min offline)
             *
             * `isReconnecting` is exposed to the UI so CallScreen can show a
             * "Reconnecting…" banner at the RTC layer the moment the network
             * drops, before the heartbeat watchdog (45 s) fires. This mirrors
             * how every production calling app behaves: WhatsApp shows the
             * banner within ~2 s of a network drop.
             */
            onConnectionStateChanged: (
              _connection: any,
              state: number,
              _reason: number
            ) => {
              const RECONNECTING = 4;
              const CONNECTED = 3;
              const FAILED = 5;
              if (state === RECONNECTING) {
                console.warn('[Agora Node] Connection lost — SDK is reconnecting.');
                setIsReconnecting(true);
              } else if (state === CONNECTED) {
                console.log('[Agora Node] Connection restored.');
                setIsReconnecting(false);
              } else if (state === FAILED) {
                console.error('[Agora Node] Reconnection failed — SDK gave up.');
                setIsReconnecting(false);
              }
            },
            onError: (err: any, msg: string) => {
              console.error(`[Agora Node] Error: ${err} - ${msg}`);
            },
          });
          // Do NOT call setDefaultAudioRouteToSpeakerphone here: the mode
          // (voice vs video) is unknown at engine-init time. The correct route
          // is applied in onJoinChannelSuccess via speakerDefaultRef.
          console.log('[Agora Node] Engine initialized.');
          logDebugEvent('agora.engine.initialized', {});
        } catch (e) {
          agoraEngineRef.current = null;
          console.log('[Agora Node] Failed to initialize native engine.');
          logDebugEvent('agora.engine.initializeFailed', { error: e }, 'error');
        }
      })();
    }

    return () => {
      // Automatic native tracking cleanup. Wait for a pending initialize so the
      // engine is not released while it is still being created.
      const ready = agoraReadyRef.current ?? Promise.resolve();
      ready.finally(() => {
        if (agoraEngineRef.current) {
          try {
            agoraEngineRef.current.release();
          } catch (e) {}
          agoraEngineRef.current = null;
        }
      });
      agoraReadyRef.current = null;
    };
  }, [provider]);

  const connectAgora = async (
    roomId: string,
    token: string,
    uid?: any,
    role?: 'broadcaster' | 'audience',
    speakerDefault = false
  ) => {
    if (Platform.OS === 'web') {
      logDebugEvent('agora.join.unsupportedPlatform', { roomId, platform: Platform.OS }, 'error');
      throw new Error('Agora calls are only available in the native app.');
    }

    if (Platform.OS === 'android') {
      const { PermissionsAndroid } = require('react-native');
      console.log('[Agora Node] Requesting Microphone and Camera permissions...');
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        PermissionsAndroid.PERMISSIONS.CAMERA,
      ]);

      const micGranted =
        granted[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] ===
        PermissionsAndroid.RESULTS.GRANTED;
      const camGranted =
        granted[PermissionsAndroid.PERMISSIONS.CAMERA] ===
        PermissionsAndroid.RESULTS.GRANTED;

      console.log(
        `[Agora Node] Permissions status - Mic: ${micGranted}, Camera: ${camGranted}`
      );

      // A call with no microphone is not a call -- previously a denial was only
      // logged and joinChannel ran anyway, so the screen showed "Talking..."
      // and billed both sides for a connection that carried no audio. The
      // camera is not required here: a video call that loses only its camera
      // still degrades sensibly (the existing video-downgrade path in
      // CallScreen), but losing the mic has no sensible degraded state.
      if (!micGranted) {
        const err: any = new Error(
          'Microphone permission is required to make or receive calls.'
        );
        err.code = 'PERMISSION_DENIED';
        throw err;
      }
    }

    // Store the requested speaker mode so onJoinChannelSuccess (which is
    // registered once during engine init as a closure) can read it.
    speakerDefaultRef.current = speakerDefault;

    // Reflect the expected final state immediately in speakerOn so the UI
    // button shows the correct label before the native callback fires.
    setSpeakerOn(speakerDefault);

    // Wait for the async engine setup (App ID fetch + initialize) to settle.
    if (agoraReadyRef.current) {
      await agoraReadyRef.current;
    }

    // Apply the route preference to the engine NOW so audio that flows before
    // onJoinChannelSuccess fires also goes to the correct route.
    if (agoraEngineRef.current) {
      agoraEngineRef.current.setDefaultAudioRouteToSpeakerphone(speakerDefault);
    }

    console.log(`[Agora Node] Joining channel: ${roomId} as ${role || 'default'}`);
    if (agoraEngineRef.current) {
      const numericUid = uid ? Number(uid) : 0;
      logDebugEvent('agora.join.invoke', { roomId, numericUid });
      console.log(`[Agora Node] Joining channel: ${roomId} with UID: ${numericUid}`);

      const clientRoleType = role === 'audience' ? 2 : 1; // 1 = Broadcaster, 2 = Audience
      const channelProfile = role ? 1 : 0; // 1 = Live Broadcasting (best for rooms), 0 = Communication (best for 1v1)
      const publishTrack = role !== 'audience';

      const res = agoraEngineRef.current.joinChannel(token, roomId, numericUid, {
        clientRoleType,
        channelProfile,
        publishMicrophoneTrack: publishTrack,
        publishCameraTrack: publishTrack,
        autoSubscribeAudio: true,
        autoSubscribeVideo: true,
      });
      console.log(`[Agora Node] joinChannel returned: ${res}`);
    } else {
      logDebugEvent('agora.join.noEngine', { roomId }, 'error');
      throw new Error('Agora native engine is not initialized.');
    }
    return agoraEngineRef.current;
  };

  const connectSeat = async (
    roomId: string,
    tokenOrUrl: string,
    userId?: any,
    role?: 'broadcaster' | 'audience',
    speakerDefault?: boolean
  ) => {
    if (provider === 'agora') {
      return await connectAgora(roomId, tokenOrUrl, userId, role, speakerDefault);
    }
    throw new Error(`Unsupported communication provider: ${provider}`);
  };

  const changeRole = async (role: 'broadcaster' | 'audience') => {
    if (provider === 'agora' && agoraEngineRef.current) {
      const roleType = role === 'audience' ? 2 : 1;
      console.log(`[Agora Node] Changing native client role to: ${role} (${roleType})`);
      agoraEngineRef.current.setClientRole(roleType);
    }
  };

  const disconnectSeat = async () => {
    if (provider === 'agora' && agoraEngineRef.current) {
      agoraEngineRef.current.leaveChannel();
    }

    console.log(`[Voice Adapter] Safe native channel teardown for: ${provider}`);
    logDebugEvent('voice.disconnect', { provider });
    setIsReconnecting(false);
  };

  const toggleMic = async () => {
    const newMutedState = !micMuted;
    setMicMuted(newMutedState);
    if (provider === 'agora' && agoraEngineRef.current) {
      agoraEngineRef.current.muteLocalAudioStream(newMutedState);
    }

    console.log(`[Audio Layer] Local microphone mute state: ${newMutedState}`);
    logDebugEvent('voice.mic.toggle', { provider, muted: newMutedState });
  };

  const toggleSpeaker = async () => {
    const newSpeakerState = !speakerOn;
    setSpeakerOn(newSpeakerState);
    if (provider === 'agora' && agoraEngineRef.current) {
      agoraEngineRef.current.setEnableSpeakerphone(newSpeakerState);
    }
    console.log(`[Audio Layer] Speaker state: ${newSpeakerState}`);
    logDebugEvent('voice.speaker.toggle', { provider, speakerOn: newSpeakerState });
  };

  const toggleCamera = async () => {
    const newCameraState = !cameraOn;
    setCameraOn(newCameraState);
    if (provider === 'agora' && agoraEngineRef.current) {
      agoraEngineRef.current.muteLocalVideoStream(!newCameraState);
    }
  };

  const flipCamera = async () => {
    if (provider === 'agora' && agoraEngineRef.current) {
      agoraEngineRef.current.switchCamera();
    }
  };

  return {
    connectSeat,
    disconnectSeat,
    changeRole,
    toggleMic,
    micMuted,
    toggleSpeaker,
    speakerOn,
    toggleCamera,
    cameraOn,
    flipCamera,
    remoteUids,
    localUid,
    isReconnecting,
  };
}
