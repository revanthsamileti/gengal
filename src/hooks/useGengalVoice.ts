import { useState, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { getAgoraEngine } from './NativeEngines';
import { logDebugEvent } from '../services/debugLogger';

export type FreeProvider = 'agora' | 'dyte' | 'daily' | 'zegocloud' | 'videosdk' | 'stream';

interface GengalVoiceInterface {
  connectSeat: (roomId: string, tokenOrUrl: string, userId?: string, role?: 'broadcaster' | 'audience') => Promise<any>;
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
}

export function useGengalVoice(provider: FreeProvider): GengalVoiceInterface {
  const [micMuted, setMicMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [remoteUids, setRemoteUids] = useState<number[]>([]);
  const [localUid, setLocalUid] = useState<number | null>(null);
  
  // Safe ref for Agora engine so it doesn't crash the web bundler
  const agoraEngineRef = useRef<any>(null);
  
  // Safe ref for Daily.co Call Object
  const dailyClientRef = useRef<any>(null);

  // Safe refs for Stream.io Call Objects
  const streamClientRef = useRef<any>(null);
  const streamCallRef = useRef<any>(null);

  // Safe ref for Red5 Pro native engine
  const red5PublisherRef = useRef<any>(null);

  // Safe ref for Dyte native engine
  const dyteClientRef = useRef<any>(null);

  const isZegoInitialized = useRef(false);

  useEffect(() => {
    // We only initialize Agora if we are not on web (react-native-agora is native only)
    if (provider === 'agora' && Platform.OS !== 'web') {
      try {
        const { createAgoraRtcEngine } = getAgoraEngine();
        agoraEngineRef.current = createAgoraRtcEngine();
        agoraEngineRef.current.initialize({ appId: 'd463dbabe1ee41ef8c4fa19c09464708' });
        agoraEngineRef.current.enableAudio();
        agoraEngineRef.current.enableVideo();
        agoraEngineRef.current.startPreview();
        agoraEngineRef.current.registerEventHandler({
          onJoinChannelSuccess: (connection: any, elapsed: number) => {
            console.log(`[Agora Node] Successfully joined channel ${connection.channelId} with uid ${connection.localUid}`);
            agoraEngineRef.current.setEnableSpeakerphone(true);
            agoraEngineRef.current.muteLocalAudioStream(false);
            setLocalUid(connection.localUid ?? 0);
          },
          onUserJoined: (connection: any, remoteUid: number, elapsed: number) => {
            console.log(`[Agora Node] Remote user joined: ${remoteUid}`);
            setRemoteUids((prev) => [...prev, remoteUid]);
          },
          onUserOffline: (connection: any, remoteUid: number, reason: any) => {
            console.log(`[Agora Node] Remote user offline: ${remoteUid}`);
            setRemoteUids((prev) => prev.filter(uid => uid !== remoteUid));
          },
          onError: (err: any, msg: string) => {
            console.error(`[Agora Node] Error: ${err} - ${msg}`);
          }
        });
        agoraEngineRef.current.setDefaultAudioRouteToSpeakerphone(true);
        agoraEngineRef.current.setEnableSpeakerphone(true);
        console.log(`[Agora Node] Engine initialized and speakerphone enabled.`);
        logDebugEvent('agora.engine.initialized', {});
      } catch (e) {
        console.log(`[Agora Node] Failed to initialize native engine.`);
        logDebugEvent('agora.engine.initializeFailed', { error: e }, 'error');
      }
    }
    
    return () => {
      // Automatic native tracking cleanup
      if (provider === 'agora' && agoraEngineRef.current) {
        try {
          agoraEngineRef.current.release();
        } catch(e) {}
      }
    };
  }, [provider]);

  const connectAgora = async (roomId: string, token: string, uid?: any, role?: 'broadcaster' | 'audience') => {
    if (Platform.OS === 'web') {
      logDebugEvent('agora.join.unsupportedPlatform', { roomId, platform: Platform.OS }, 'error');
      throw new Error('Agora calls are only available in the native app.');
    }

    if (Platform.OS === 'android') {
      const { PermissionsAndroid } = require('react-native');
      try {
        console.log('[Agora Node] Requesting Microphone and Camera permissions...');
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          PermissionsAndroid.PERMISSIONS.CAMERA,
        ]);
        
        const micGranted = granted[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
        const camGranted = granted[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED;
        
        console.log(`[Agora Node] Permissions status - Mic: ${micGranted}, Camera: ${camGranted}`);
        if (!micGranted) {
          console.warn('[Agora Node] Microphone permission denied. Audio will not be recorded.');
        }
      } catch (err) {
        console.warn('[Agora Node] Permissions request failed:', err);
      }
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
         autoSubscribeVideo: true
      });
      console.log(`[Agora Node] joinChannel returned: ${res}`);
    } else {
      logDebugEvent('agora.join.noEngine', { roomId }, 'error');
      throw new Error('Agora native engine is not initialized.');
    }
    return agoraEngineRef.current;
  };

  const connectSeat = async (roomId: string, tokenOrUrl: string, userId?: any, role?: 'broadcaster' | 'audience') => {
    if (provider === 'agora') {
      return await connectAgora(roomId, tokenOrUrl, userId, role);
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

  return { connectSeat, disconnectSeat, changeRole, toggleMic, micMuted, toggleSpeaker, speakerOn, toggleCamera, cameraOn, flipCamera, remoteUids, localUid };
}
