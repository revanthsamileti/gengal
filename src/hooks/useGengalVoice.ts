import { useState, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { getAgoraEngine } from './NativeEngines';

export type FreeProvider = 'agora' | 'dyte' | 'daily' | 'zegocloud' | 'videosdk' | 'stream';

interface GengalVoiceInterface {
  connectSeat: (roomId: string, tokenOrUrl: string, userId?: string) => Promise<any>;
  disconnectSeat: () => Promise<void>;
  toggleMic: () => void;
  micMuted: boolean;
  toggleSpeaker: () => void;
  speakerOn: boolean;
}

export function useGengalVoice(provider: FreeProvider): GengalVoiceInterface {
  const [micMuted, setMicMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);
  
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
        console.log(`[Agora Node] Engine initialized.`);
      } catch (e) {
        console.log(`[Agora Node] Failed to initialize native engine.`);
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

  const connectAgora = async (roomId: string, token: string) => {
    if (Platform.OS === 'web') {
      console.warn(`[Agora Guard] Agora Native is not supported on web. Use Daily.co for web testing.`);
      return;
    }
    console.log(`[Agora Node] Joining channel: ${roomId}`);
    if (agoraEngineRef.current) {
      agoraEngineRef.current.joinChannel(token, roomId, 0, {
         clientRoleType: 1, // Broadcaster
         channelProfile: 1, // Live Broadcasting
      });
    }
    return agoraEngineRef.current;
  };

  const connectSeat = async (roomId: string, tokenOrUrl: string, userId?: string) => {
    if (provider === 'agora') {
      return await connectAgora(roomId, tokenOrUrl);
    }
    console.error(`Unknown communication provider layout: ${provider}`);
  };

  const disconnectSeat = async () => {
    if (provider === 'agora' && agoraEngineRef.current) {
      agoraEngineRef.current.leaveChannel();
    }

    console.log(`[Voice Adapter] Safe native channel teardown for: ${provider}`);
  };

  const toggleMic = async () => {
    const newMutedState = !micMuted;
    setMicMuted(newMutedState);
    if (provider === 'agora' && agoraEngineRef.current) {
      agoraEngineRef.current.muteLocalAudioStream(newMutedState);
    }

    console.log(`[Audio Layer] Local microphone mute state: ${newMutedState}`);
  };

  const toggleSpeaker = async () => {
    const newSpeakerState = !speakerOn;
    setSpeakerOn(newSpeakerState);
    if (provider === 'agora' && agoraEngineRef.current) {
      agoraEngineRef.current.setEnableSpeakerphone(newSpeakerState);
    }
    console.log(`[Audio Layer] Speaker state: ${newSpeakerState}`);
  };

  return { connectSeat, disconnectSeat, toggleMic, micMuted, toggleSpeaker, speakerOn };
}
