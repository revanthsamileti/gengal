import React, { useState } from 'react';
import { tap42 } from '../theme/touch';
import { Platform, Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View, } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import GengalAvatar from '../components/GengalAvatar';
import { RtcSurfaceView } from '../hooks/AgoraViews';
import { skeuo } from '../theme/skeuomorphic';
import { useGengalVoice, FreeProvider } from '../hooks/useGengalVoice';
import { auth, db } from '../config/firebase';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { transferCoins, processCallBilling } from '../services/coinService';
import { subscribeToGlobalSettings, GlobalSettings } from '../services/adminService';
import ConnectingOverlay from '../components/ConnectingOverlay';
import { createCallOffer, acceptCallOffer, rejectCallOffer, subscribeToOutboundCallStatus, clearCallOffer, openCallRecord, closeCallRecord } from '../services/liveRoomService';
import IncomingCallOverlay from '../components/IncomingCallOverlay';
import { authedPost } from '../services/authService';
import { generateRoomId } from '../utils/ids';
import { Alert } from '../components/CustomAlert';
import { useActionLock } from '../hooks/useActionLock';

// A call that is never answered must not ring forever: the caller path leaves
// `isConnecting` true, so neither the peer-timeout nor the heartbeat watchdog
// can fire. This is the only thing that ends an unanswered outbound call.
const RING_TIMEOUT_MS = 45000;

/**
 * Providers the app can actually carry a call on, in preference order.
 *
 * Only Agora is implemented — `useGengalVoice.connectSeat` throws for anything
 * else. Listing `zegocloud` here was worse than useless: on a video call the
 * hop off Agora fired "Switched to voice — you are being charged the lower
 * voice rate", which was false, because zego then failed too (no adapter, and
 * the backend returns 503 without credentials) and the call was dropped a
 * moment later. One honest "Connection failed" beats a reassuring lie followed
 * by the same failure.
 *
 * Adding a provider back means implementing its adapter first. Keep the
 * `losesVideo` downgrade below when you do — without it the server keeps
 * charging the video rate for a call that has gone audio-only.
 */
const WATERFALL: FreeProvider[] = ['agora'];

type CallScreenProps = {
  profileName?: string;
  mode?: 'call' | 'video';
  roomId?: string;
  matchData?: any;
  isCaller?: boolean;
  isIncomingPending?: boolean;
  navigate: (screen: string, params?: { profileName?: string; mode?: 'call' | 'video'; roomId?: string; matchData?: any; isCaller?: boolean; isIncomingPending?: boolean }) => void;
  goBack: () => void;
};

export default function CallScreen({ profileName, mode = 'call', roomId: initialRoomId, matchData, isCaller, isIncomingPending = false, navigate, goBack }: CallScreenProps) {
  const [roomId] = useState(initialRoomId || generateRoomId());
  // Age is shown only when the peer actually has one. It previously defaulted
  // to '24', which displayed a fabricated age for every user missing the field.
  const profile = matchData ? {
    name: matchData.nickname || matchData.name,
    uri: matchData.uri || matchData.avatarUrl || '',
    age: matchData.age || null,
    avatarData: matchData.avatarData
  } : { name: profileName || 'User', uri: '', age: null as string | null };

  // Only Agora can render remote video here. If the waterfall falls through to
  // any other provider the call is audio-only, so it must stop being treated —
  // and billed — as video.
  const [videoDowngraded, setVideoDowngraded] = useState(false);
  const isVideo = mode === 'video' && !videoDowngraded;
  const [isGifting, setIsGifting] = useState(false);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<any>(null);
  const [isConnecting, setIsConnecting] = useState(!isIncomingPending);
  const [isPending, setIsPending] = useState(isIncomingPending);
  const [callerStatus, setCallerStatus] = useState<'calling' | 'accepted' | 'rejected' | null>(null);
  const [callStep, setCallStep] = useState<'connecting' | 'ringing' | 'talking'>('connecting');
  const overlayStatus = (isCaller && callStep === 'ringing') ? 'ringing' : 'connecting';

  const [callDurationSeconds, setCallDurationSeconds] = useState(0);
  const [callerLiveCoins, setCallerLiveCoins] = useState(0);
  const [isPeerUnstable, setIsPeerUnstable] = useState(false);
  const isCallActive = isCaller ? (callerStatus === 'accepted') : (!isPending);

  const lastObservedCallerHeartbeatRef = React.useRef<number | null>(null);
  const lastObservedReceiverHeartbeatRef = React.useRef<number | null>(null);
  const lastObservedCallerTimeRef = React.useRef<number>(Date.now());
  const lastObservedReceiverTimeRef = React.useRef<number>(Date.now());

  const endCall = async () => {
    disconnectSeat();
    const user = auth.currentUser;
    if (isCaller && roomId) {
      closeCallRecord(roomId);
    }
    const incomingCallDocId = isCaller ? matchData?.uid : user?.uid;
    if (incomingCallDocId) {
      try {
        await clearCallOffer(incomingCallDocId);
      } catch (e) {
        console.warn("Failed to clear call offer on end call", e);
      }
    }
    goBack();
  };

  // Guarded so a double-tap on End (or Back) cannot fire two teardowns.
  const { locked: isEnding, run: runEndCall } = useActionLock();
  const handleEndCall = () => runEndCall(endCall);

  // An unanswered outbound call otherwise rings indefinitely: the caller path
  // keeps `isConnecting` true, which disables both the peer timeout and the
  // heartbeat watchdog below.
  React.useEffect(() => {
    if (!isCaller || callStep !== 'ringing') return;

    const timer = setTimeout(() => {
      Alert.alert('No answer', `${profile.name} did not pick up.`, [{ text: 'OK' }]);
      void endCall();
    }, RING_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [isCaller, callStep]);

  // A call needs a resolvable peer uid: without it no offer can be created and
  // the screen would otherwise sit on the connecting overlay forever.
  React.useEffect(() => {
    if (isCaller && !matchData?.uid) {
      Alert.alert('Unavailable', 'This profile cannot be called right now.', [{ text: 'OK' }]);
      goBack();
    }
  }, [isCaller, matchData?.uid]);

  // 0. Fetch current user profile to determine gender/role
  React.useEffect(() => {
    const user = auth.currentUser;
    if (user) {
      import('../services/userService').then(({ getUserProfile }) => {
        getUserProfile(user.uid).then(p => {
          setCurrentUserProfile(p);
          if (p?.coins) setCallerLiveCoins(p.coins);
        });
      });
    }
  }, []);

  // 1. Initialize the 40K Multi-Adapter
  const initialProvider = (matchData?.audioProvider || 'agora') as FreeProvider;
  const audioToken = matchData?.audioTokenOrUrl || '';
  const [currentProvider, setCurrentProvider] = useState<FreeProvider>(initialProvider);
  const { connectSeat, disconnectSeat, toggleMic, micMuted, toggleSpeaker, speakerOn, toggleCamera, cameraOn, flipCamera, localUid, remoteUids } = useGengalVoice(currentProvider);

  // Firestore listener for room provider updates (so both users stay in sync on
  // fallbacks). This lives on the `calls` record rather than `rooms`, because
  // direct (non-matchmade) calls never create a `rooms` document.
  React.useEffect(() => {
    if (!roomId) return;
    const unsub = onSnapshot(doc(db, 'calls', roomId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.audioProvider && data.audioProvider !== currentProvider) {
          console.log(`[Waterfall] Room provider changed by peer to ${data.audioProvider}. Connecting...`);
          setCurrentProvider(data.audioProvider as FreeProvider);
        }
        // The server bills from this field, so it is the authority on what the
        // call has actually become after a fallback — not the `mode` prop.
        if (data.mode === 'call' && mode === 'video') {
          setVideoDowngraded(true);
        }
      }
    });
    return unsub;
  }, [roomId, currentProvider]);

  // Listen for the incoming_calls document being deleted, which means the call ended.
  React.useEffect(() => {
    if (isCaller) return;
    const user = auth.currentUser;
    if (!user) return;

    const unsub = onSnapshot(doc(db, 'incoming_calls', user.uid), (snap) => {
      if (!snap.exists()) {
        console.log("[CallScreen] Call offer document deleted. Ending call.");
        disconnectSeat();
        goBack();
      } else {
        const data = snap.data();
        if (data.status === 'rejected') {
          console.log("[CallScreen] Call rejected by caller. Ending call.");
          disconnectSeat();
          goBack();
        }
        
        // Receiver records caller heartbeat updates (immune to clock drift)
        if ((data.status === 'accepted' || !isPending) && data.callerHeartbeat) {
          if (lastObservedCallerHeartbeatRef.current === null || data.callerHeartbeat !== lastObservedCallerHeartbeatRef.current) {
            lastObservedCallerHeartbeatRef.current = data.callerHeartbeat;
            lastObservedCallerTimeRef.current = Date.now();
          }
        }
      }
    });
    return unsub;
  }, [isCaller, isPending]);

  // 2. Automatically connect to the voice room when the screen mounts or provider changes
  React.useEffect(() => {
    let isMounted = true;
    
    if (isPending) return; // Wait until accepted!
    if (isCaller && callerStatus !== 'accepted') return; // Wait for receiver to accept!

    const establishSecureCall = async () => {
      if (!roomId) return;
      if (isMounted) setIsConnecting(true);
      
      let connectionToken = audioToken;
      let extraParam = auth.currentUser?.uid || '';
      const user = auth.currentUser;

      const connectionPromise = async () => {
        // Ephemeral RTC keys are minted by the backend, which derives the uid
        // from the bearer token rather than trusting the request body.
        if (currentProvider === 'agora' && user) {
          console.log("[CallScreen] Requesting secure ephemeral key from token authority...");
          const credentials = await authedPost<{ token: string; uid?: number }>(
            '/api/v1/agora/generate-token',
            { roomId }
          );
          connectionToken = credentials.token;
          if (credentials.uid) extraParam = String(credentials.uid);
        } else if (currentProvider === 'zegocloud' && user) {
          console.log("[CallScreen] Resolving crypto credentials from Zego Token Authority...");
          const tokenPayload = await authedPost<{ token: string }>(
            '/api/v1/zego/generate-token',
            { roomId }
          );
          connectionToken = tokenPayload.token;
        }

        if (isMounted) {
          await connectSeat(roomId, connectionToken, extraParam);
          if (isMounted) setIsConnecting(false);
        }
      };

      try {
        // Enforce a strict 7-second timeout for the provider to connect
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Connection Timeout")), 7000));
        await Promise.race([connectionPromise(), timeoutPromise]);
      } catch (error) {
        console.error(`[Waterfall] Provider ${currentProvider} failed:`, error);
        
        // Trigger Waterfall Fallback. Only the caller publishes the switch — it
        // owns the `calls` record, and the receiver picks the change up through
        // the listener above.
        const currentIndex = WATERFALL.indexOf(currentProvider);
        if (currentIndex !== -1 && currentIndex + 1 < WATERFALL.length) {
          const nextProvider = WATERFALL[currentIndex + 1];
          console.warn(`[Waterfall] Falling back to next adapter: ${nextProvider}`);
          // Falling off Agora means remote video can no longer be rendered.
          // Downgrade the record to a voice call so the backend stops charging
          // the video rate for what is now an audio-only call.
          const losesVideo = mode === 'video' && nextProvider !== 'agora';

          if (isCaller) {
            try {
              await updateDoc(doc(db, 'calls', roomId), {
                audioProvider: nextProvider,
                ...(losesVideo ? { mode: 'call' } : {}),
              });
            } catch (e) {
              console.error("[Waterfall] Failed to update call record with new provider", e);
            }
          } else {
            setCurrentProvider(nextProvider);
          }

          if (losesVideo) {
            setVideoDowngraded(true);
            Alert.alert(
              'Switched to voice',
              'Video was unavailable on this connection, so the call continued as voice — you are being charged the lower voice rate.',
              [{ text: 'OK' }]
            );
          }
        } else {
          Alert.alert(
            'Connection failed',
            'We could not establish a secure connection. Please try again later.',
            [{ text: 'OK' }]
          );
          goBack();
        }
      }
    };

    establishSecureCall();

    return () => {
      isMounted = false;
      disconnectSeat();
    };
  }, [roomId, currentProvider, isPending, isCaller, callerStatus]);

  // 2b. Initiate call if Caller (runs once on mount)
  React.useEffect(() => {
    if (!isCaller || !roomId || !matchData?.uid || !currentUserProfile) return;
    
    const callerName = currentUserProfile.name || currentUserProfile.nickname || 'Someone';
    const callerAvatarUrl = currentUserProfile.avatarUrl || currentUserProfile.uri || null;

    import('../services/debugLogger').then(({ logDebugEvent }) => {
      logDebugEvent('call.createOffer.start', { targetUid: matchData.uid, roomId });

      // Open the history record first so both sides have a document to sync the
      // active provider through.
      openCallRecord(
        roomId,
        { uid: auth.currentUser!.uid, name: callerName, avatarUrl: callerAvatarUrl, avatarData: currentUserProfile.avatarData },
        { uid: matchData.uid, name: profile.name, avatarUrl: matchData.avatarUrl || matchData.uri, avatarData: matchData.avatarData },
        mode
      ).catch(e => console.warn('Failed to open call record', e));

      createCallOffer(
        auth.currentUser!.uid,
        matchData.uid,
        callerName,
        callerAvatarUrl,
        currentUserProfile.avatarData || null,
        mode,
        roomId
      ).then(() => {
        logDebugEvent('call.createOffer.success', { targetUid: matchData.uid });
        setCallStep('ringing');
      }).catch(e => {
        console.warn('Failed to send call offer', e);
        logDebugEvent('call.createOffer.failed', { error: String(e), targetUid: matchData.uid }, 'error');
        Alert.alert('Could not connect', 'Could not reach that user. Please try again.', [{ text: 'OK' }]);
        goBack();
      });
    });

    return () => {
      if (isCaller && matchData?.uid) {
        clearCallOffer(matchData.uid).catch(() => {});
      }
    };
  }, [isCaller, roomId, matchData?.uid, currentUserProfile]);

  // 2c. Listen for status changes on the outbound call offer
  React.useEffect(() => {
    if (!isCaller || !matchData?.uid) return;

    const unsubStatus = subscribeToOutboundCallStatus(matchData.uid, (status, data) => {
      setCallerStatus(status);
      if (status === 'accepted') {
        setCallStep('talking');
      } else if (status === 'rejected') {
        Alert.alert('Call declined', `${profile.name} declined the call.`, [{ text: 'OK' }]);
        disconnectSeat();
        goBack();
      } else if (status === null && callStep === 'talking') {
        // Only disconnect if the call was already active (talking) and is now cleared
        disconnectSeat();
        goBack();
      }

      // Caller records receiver heartbeat updates (immune to clock drift)
      const callData = data as any;
      if (status === 'accepted' && callData?.receiverHeartbeat) {
        if (lastObservedReceiverHeartbeatRef.current === null || callData.receiverHeartbeat !== lastObservedReceiverHeartbeatRef.current) {
          lastObservedReceiverHeartbeatRef.current = callData.receiverHeartbeat;
          lastObservedReceiverTimeRef.current = Date.now();
        }
      }
    });

    return () => {
      unsubStatus();
    };
  }, [isCaller, matchData?.uid, callStep]);

  // 2c. Send periodic local heartbeat to keep the call signaling document alive
  React.useEffect(() => {
    if (!isCallActive || !roomId) return;
    const callDocId = isCaller ? matchData?.uid : auth.currentUser?.uid;
    if (!callDocId) return;

    const sendHeartbeat = () => {
      import('../services/liveRoomService').then(({ updateCallHeartbeat }) => {
        updateCallHeartbeat(callDocId, isCaller ? 'caller' : 'receiver');
      });
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 5000);
    return () => clearInterval(interval);
  }, [isCallActive, isCaller, roomId, matchData?.uid]);

  // 2d. Auto-hangup if peer is offline on Agora for more than 10 seconds
  React.useEffect(() => {
    if (isPending || isConnecting || remoteUids.length > 0) return;

    const timeout = setTimeout(() => {
      console.log("[CallScreen] Peer connection timeout. Terminating call.");
      Alert.alert('Call ended', 'The connection to the other person was lost.', [{ text: 'OK' }]);
      disconnectSeat();
      goBack();
    }, 10000);

    return () => clearTimeout(timeout);
  }, [isPending, isConnecting, remoteUids.length]);

  // 3. Fetch global billing settings
  React.useEffect(() => {
    const unsub = subscribeToGlobalSettings((settings) => {
      setGlobalSettings(settings);
    });
    return unsub;
  }, []);

  // 4. Background Billing Loop (ticks the server every 15s)
  const syncIntervalRef = React.useRef(0);

  // Periodic check for heartbeat timeout (immune to clock drift)
  React.useEffect(() => {
    if (!isCallActive) return;

    // Reset the baseline timestamps NOW so the watchdog does not fire immediately
    // on the first tick due to stale component-mount timestamps.
    lastObservedCallerTimeRef.current = Date.now();
    lastObservedReceiverTimeRef.current = Date.now();
    // Also clear any stale heartbeat values so the first snapshot update is counted
    lastObservedCallerHeartbeatRef.current = null;
    lastObservedReceiverHeartbeatRef.current = null;

    const interval = setInterval(() => {
      const now = Date.now();
      const lastTime = isCaller ? lastObservedReceiverTimeRef.current : lastObservedCallerTimeRef.current;
      const elapsed = now - lastTime;

      if (elapsed > 20000) {
        setIsPeerUnstable(true);
      } else {
        setIsPeerUnstable(false);
      }

      if (elapsed > 45000) {
        console.log(`[CallScreen] Heartbeat timed out after ${elapsed}ms. Ending call.`);
        Alert.alert(
          'Call ended',
          isCaller ? `${profile.name}'s connection was lost.` : "The caller's connection was lost.",
          [{ text: 'OK' }]
        );
        disconnectSeat();
        goBack();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isCallActive, isCaller]);

  React.useEffect(() => {
    if (!roomId || !matchData?.uid || !globalSettings || !currentUserProfile || !isCallActive) return;

    // Billing is server-authoritative: the backend measures elapsed time from
    // its own clock and applies the configured rate. Both participants tick the
    // same endpoint, so the payer cannot ride for free by patching its client.
    // The local figure below is a display estimate only.
    const billingRatePerSec =
      (isVideo ? globalSettings.videoCallRatePerMin : globalSettings.voiceCallRatePerMin) / 60;

    const billingInterval = setInterval(async () => {
      const user = auth.currentUser;
      if (!user) return;

      // Pause ticks while the peer link is down so neither side pays for dead air.
      if (isPeerUnstable) {
        console.log("[CallScreen] Peer connection is unstable. Pausing billing ticks.");
        return;
      }

      if (isCaller) {
        setCallerLiveCoins(prev => Math.max(0, prev - billingRatePerSec));
      }

      syncIntervalRef.current += 1;
      setCallDurationSeconds(prev => prev + 1);

      if (syncIntervalRef.current >= 15) {
        const secondsInThisBatch = syncIntervalRef.current;
        syncIntervalRef.current = 0;

        try {
          const result = await processCallBilling(roomId);

          // Keep the on-screen balance aligned with the authoritative figure.
          if (isCaller && typeof result.payerNewBalance === 'number') {
            setCallerLiveCoins(result.payerNewBalance);
          }

          if (result.hasInsufficientFunds) {
            console.warn(`[Billing Engine] Call disconnected: User ran out of coins.`);
            Alert.alert(
              'Call ended',
              isCaller
                ? 'You have run out of coins. Top up to keep talking.'
                : 'The caller has run out of coins.',
              [{ text: 'OK' }]
            );
            disconnectSeat();
            goBack();
            return;
          }
        } catch (error: any) {
          console.warn(`[Billing Engine] Error syncing billing: ${error.message}`);
        }

        // Rewards are staggered so they do not contend with the billing
        // transaction on the same user document.
        setTimeout(async () => {
          try {
            const { updateCallRewards } = await import('../services/coinService');
            await updateCallRewards(user.uid, secondsInThisBatch, globalSettings.callDurationForHeart, !isCaller);
          } catch (e) {
            console.warn("[Rewards Engine] Failed to update call rewards", e);
          }
        }, isCaller ? 3000 : 6000);
      }
    }, 1000);

    return () => {
      clearInterval(billingInterval);

      const remainingSeconds = syncIntervalRef.current;
      const user = auth.currentUser;

      // Final tick so the last partial interval is charged from the server clock.
      processCallBilling(roomId)
        .catch(e => console.warn('[Billing Engine] Final flush failed:', e));

      if (remainingSeconds > 0 && user) {
        import('../services/coinService').then(({ updateCallRewards }) => {
          updateCallRewards(user.uid, remainingSeconds, globalSettings.callDurationForHeart, !isCaller)
            .catch(e => console.warn("[Rewards Engine] Final flush failed", e));
        });
      }
    };
  }, [roomId, matchData?.uid, globalSettings, currentUserProfile, isCaller, isVideo, isCallActive]);

  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const sendGift = async (amount: number) => {
    const user = auth.currentUser;
    if (!user || !matchData?.uid) return;

    setIsGifting(true);
    try {
      await transferCoins(user.uid, matchData.uid, amount);
      Alert.alert('Gift sent', `You sent a ${amount}G gift to ${profile.name}.`, [{ text: 'OK' }]);
    } catch (error: any) {
      Alert.alert('Gift failed', error?.message || 'Could not send the gift.', [{ text: 'OK' }]);
    }
    setIsGifting(false);
  };

  // Confirm before moving coins — this used to fire on a single tap with no
  // way back, so a mis-tap during a call cost the user real balance.
  const handleGift = (amount: number) => {
    if (isGifting) return;
    Alert.alert(
      'Send gift?',
      `This will send ${amount}G to ${profile.name}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: `Send ${amount}G`, onPress: () => { void sendGift(amount); } },
      ]
    );
  };

  if (isPending) {
    return (
      <ScreenShell tone="dark">
        <IncomingCallOverlay
          call={{
            callerUid: matchData?.uid || '',
            callerName: profile.name,
            callerAvatarUrl: profile.uri,
            roomId: roomId || '',
            mode: mode,
            status: 'calling',
            timestamp: null,
          }}
          onAccept={() => {
            if (auth.currentUser) {
              acceptCallOffer(auth.currentUser.uid).catch(e =>
                console.warn('Failed to accept call:', e)
              );
            }
            setIsPending(false);
            setIsConnecting(true);
          }}
          onReject={() => {
            if (auth.currentUser) {
              rejectCallOffer(auth.currentUser.uid).catch(e =>
                console.warn('Failed to reject call:', e)
              );
            }
            goBack();
          }}
        />
      </ScreenShell>
    );
  }

  if (!isVideo) {
    return (
      <ScreenShell tone="light">
        {isConnecting && (
          <ConnectingOverlay 
            mode="private" 
            targetName={profile.name}
            onCancel={handleEndCall} 
            status={overlayStatus}
          />
        )}
        <View style={styles.voicePhone}>
          <View style={styles.voiceContent}>
            <View style={styles.voiceAvatarShadow}>
              <LinearGradient
                colors={['#FFFFFF', '#F2E7DD']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.voiceAvatarOuter}
              >
                <View style={styles.voiceAvatarInner}>
                  {(profile as any).avatarData ? (
                    <GengalAvatar data={(profile as any).avatarData} size={200} />
                  ) : (
                    <Image source={{ uri: profile.uri }} style={styles.voiceAvatar} />
                  )}
                </View>
              </LinearGradient>
            </View>

            <Text style={styles.voiceName}>{profile.age ? `${profile.name}, ${profile.age}` : profile.name}</Text>
            <Text style={[styles.voiceStatus, isPeerUnstable && { color: '#B30005', fontWeight: '800' }]}>
              {isPeerUnstable ? 'Reconnecting peer...' : 'Talking...'}
            </Text>
            <Text style={{ fontSize: 24, fontWeight: '700', color: '#4B0054', marginTop: 12 }}>{formatTimer(callDurationSeconds)}</Text>
            
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16, backgroundColor: '#FFFDF8', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, boxShadow: Platform.OS === 'web' ? '0 4px 12px rgba(68, 44, 21, 0.05)' : undefined }}>
              <MaterialIcons name="account-balance-wallet" size={20} color="#D49A0B" />
              <Text style={{ fontSize: 16, fontWeight: '800', color: '#4B0054', marginLeft: 6 }}>
                {Math.floor(callerLiveCoins)} G
              </Text>
            </View>
          </View>

          <View style={styles.voiceControlsBar}>
            <View style={styles.voiceControls}>
              <TouchableOpacity style={styles.voiceControlItem} activeOpacity={0.82} onPress={toggleMic}>
                <View style={[styles.voiceControlButton, micMuted && styles.voiceControlButtonActive]}>
                  <MaterialIcons name={micMuted ? "mic-off" : "mic"} size={21} color={micMuted ? "#B30005" : "#4B0054"} />
                </View>
                <Text style={styles.voiceControlLabel}>{micMuted ? "Muted" : "Mute"}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.voiceControlItem} activeOpacity={0.82} onPress={toggleSpeaker}>
                <View style={[styles.voiceControlButton, speakerOn && styles.voiceControlButtonActive]}>
                  <MaterialIcons name={speakerOn ? "volume-up" : "volume-off"} size={21} color={speakerOn ? "#4B0054" : "#9A856E"} />
                </View>
                <Text style={styles.voiceControlLabel}>{speakerOn ? "Speaker" : "Earpiece"}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.voiceControlItem}
                activeOpacity={0.82}
                onPress={() => handleGift(100)} // Send 100G Rose
                disabled={isGifting}
              >
                <View style={[styles.voiceControlButton, { borderColor: '#E8CA58', borderWidth: 2 }]}>
                  <MaterialIcons name="card-giftcard" size={21} color="#E8CA58" />
                </View>
                <Text style={styles.voiceControlLabel}>{isGifting ? "Sending..." : "100G Rose"}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.voiceControlItem}
                activeOpacity={0.82}
                onPress={handleEndCall}
                disabled={isEnding}
                accessibilityRole="button"
                accessibilityLabel="End call"
              >
                <View style={styles.voiceEndButton}>
                  <MaterialIcons name="call-end" size={23} color="#FFFFFF" />
                </View>
                <Text style={styles.voiceEndLabel}>End</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell tone="dark">
      {isConnecting && (
        <ConnectingOverlay 
          mode="private" 
          targetName={profile.name}
          onCancel={handleEndCall} 
          status={overlayStatus}
        />
      )}
      <View style={styles.videoPhone}>
        {isPeerUnstable && (
          <View style={{
            position: 'absolute',
            top: 100,
            left: 20,
            right: 20,
            backgroundColor: 'rgba(180, 0, 5, 0.9)',
            padding: 12,
            borderRadius: 12,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}>
            <MaterialIcons name="wifi-off" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
            <Text style={{ color: '#FFFFFF', fontWeight: 'bold', fontSize: 15 }}>
              Connection unstable. Reconnecting...
            </Text>
          </View>
        )}
        {(currentProvider === 'agora' && RtcSurfaceView && remoteUids.length > 0) ? (
          <RtcSurfaceView canvas={{ uid: remoteUids[0] }} style={styles.videoRemoteImage} />
        ) : (
          <LinearGradient
            colors={['#1B0718', '#4B0054', '#11040F']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.videoOffBackdrop}
          >
            <View style={styles.videoOffHalo}>
              <LinearGradient
                colors={['#FFF8DF', '#B19622', '#F6D96B']}
                style={styles.videoOffAvatarRing}
              >
                <View style={styles.videoOffAvatarInner}>
                  {profile.avatarData ? (
                    <GengalAvatar data={profile.avatarData} size={110} />
                  ) : (
                    <Image source={{ uri: profile.uri }} style={styles.videoOffAvatar} />
                  )}
                </View>
              </LinearGradient>
              <View style={styles.videoOffIcon}>
                <MaterialIcons name="videocam-off" size={25} color="#4B0054" />
              </View>
            </View>
            <Text style={styles.videoOffName}>{profile.age ? `${profile.name}, ${profile.age}` : profile.name}</Text>
            <Text style={styles.videoOffStatus}>Connecting to video...</Text>
          </LinearGradient>
        )}
        <LinearGradient
          colors={cameraOn
            ? ['rgba(18, 6, 12, 0.62)', 'rgba(18, 6, 12, 0.04)', 'rgba(18, 6, 12, 0.32)']
            : ['rgba(18, 6, 12, 0.34)', 'rgba(18, 6, 12, 0.02)', 'rgba(18, 6, 12, 0.22)']}
          locations={[0, 0.42, 1]}
          style={styles.videoShade}
        />

        <View style={styles.videoTopBar}>
          <TouchableOpacity
            style={styles.videoCircleButton}
            hitSlop={tap42}
            activeOpacity={0.82}
            onPress={handleEndCall}
            disabled={isEnding}
            accessibilityRole="button"
            accessibilityLabel="End call and go back"
          >
            <MaterialIcons name="arrow-back" size={23} color="#4B0054" />
          </TouchableOpacity>
          <View style={styles.videoTitleBlock}>
            <Text style={styles.videoName} numberOfLines={1}>{profile.name}</Text>
          </View>
          <View style={styles.videoTimerPill}>
            <Text style={styles.videoTimer}>{formatTimer(callDurationSeconds)}</Text>
          </View>
          <View style={{ marginLeft: 6, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16 }}>
            <MaterialIcons name="account-balance-wallet" size={14} color="#D49A0B" />
            <Text style={{ fontSize: 13, fontWeight: '800', color: '#FFF', marginLeft: 3 }}>
              {Math.floor(callerLiveCoins)} G
            </Text>
          </View>
        </View>

        <View style={styles.selfPreview}>
          {cameraOn ? (
            (currentProvider === 'agora' && RtcSurfaceView && localUid !== null) ? (
              <RtcSurfaceView canvas={{ uid: 0 }} style={StyleSheet.absoluteFill} />
            ) : (
              <Image source={{ uri: currentUserProfile?.avatarUrl || ''  }} style={StyleSheet.absoluteFill} />
            )
          ) : (
            <View style={styles.selfPreviewOffContent}>
              {currentUserProfile?.avatarData ? (
                <GengalAvatar data={currentUserProfile.avatarData} size={50} />
              ) : (
                <Image source={{ uri: currentUserProfile?.avatarUrl || ''  }} style={styles.selfPreviewAvatar} />
              )}
              <View style={styles.selfPreviewOffBadge}>
                <MaterialIcons name="videocam-off" size={15} color="#FFFDF8" />
              </View>
            </View>
          )}
        </View>

        <View style={styles.videoControlsTray}>
          <TouchableOpacity style={styles.videoControlItem} activeOpacity={0.82} onPress={toggleMic}>
            <View style={[styles.videoControlButton, micMuted && styles.videoControlButtonActive]}>
              <MaterialIcons name={micMuted ? "mic-off" : "mic"} size={22} color={micMuted ? "#B30005" : "#756A62"} />
            </View>
            <Text style={styles.videoControlLabel}>{micMuted ? "Muted" : "Mute"}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.videoControlItem}
            activeOpacity={0.82}
            onPress={toggleCamera}
          >
            <View style={[styles.videoControlButton, !cameraOn && styles.videoControlButtonActive]}>
              <MaterialIcons name={cameraOn ? 'videocam' : 'videocam-off'} size={22} color={cameraOn ? '#756A62' : '#B30005'} />
            </View>
            <Text style={styles.videoControlLabel}>{cameraOn ? "Camera" : "Cam Off"}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.videoControlItem} activeOpacity={0.82} onPress={flipCamera}>
            <View style={styles.videoControlButton}>
              <MaterialIcons name="flip-camera-ios" size={22} color="#756A62" />
            </View>
            <Text style={styles.videoControlLabel}>Flip</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.videoControlItem}
            activeOpacity={0.82}
            onPress={handleEndCall}
            disabled={isEnding}
            accessibilityRole="button"
            accessibilityLabel="End call"
          >
            <View style={styles.videoEndButton}>
              <MaterialIcons name="call-end" size={25} color="#FFFFFF" />
            </View>
            <Text style={styles.videoEndLabel}>End</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  voicePhone: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 430,
    backgroundColor: '#FFFCF7',
  },
  voiceContent: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 34,
    backgroundColor: '#FFFCF7',
  },
  voiceAvatarShadow: {
    width: 212,
    height: 212,
    borderRadius: 106,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    boxShadow: Platform.OS === 'web' ? '0 12px 28px rgba(72, 54, 42, 0.22)' : undefined,
  },
  voiceAvatarOuter: {
    width: 202,
    height: 202,
    borderRadius: 101,
    padding: 5,
  },
  voiceAvatarInner: {
    flex: 1,
    borderRadius: 96,
    padding: 5,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  voiceAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 91,
  },
  voiceName: {
    marginTop: 62,
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 33,
    fontWeight: '900',
  },
  voiceStatus: {
    marginTop: 4,
    color: '#9A7A08',
    fontFamily: 'serif',
    fontSize: 21,
    fontStyle: 'italic',
    fontWeight: '700',
  },
  voiceControlsBar: {
    minHeight: 154,
    paddingHorizontal: 22,
    paddingTop: 26,
    paddingBottom: 26,
    backgroundColor: '#F9F5EF',
    borderTopWidth: 1,
    borderTopColor: '#EFE8DD',
    boxShadow: Platform.OS === 'web' ? '0 -12px 28px rgba(80, 55, 36, 0.10)' : undefined,
  },
  voiceControls: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  voiceControlItem: {
    width: 78,
    alignItems: 'center',
    gap: 10,
  },
  voiceControlButton: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1ECE4',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  voiceControlButtonActive: {
    backgroundColor: '#EADCD0',
    boxShadow: Platform.OS === 'web' ? '0 2px 4px rgba(0,0,0,0.1)' : undefined,
  },
  voiceEndButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#B30005',
    borderWidth: 1,
    borderColor: '#C53A3A',
    boxShadow: Platform.OS === 'web' ? '0 11px 20px rgba(179, 0, 5, 0.28)' : undefined,
  },
  voiceControlLabel: {
    color: '#3E3440',
    fontSize: 13,
    fontWeight: '800',
  },
  voiceEndLabel: {
    color: '#B30005',
    fontSize: 13,
    fontWeight: '900',
  },
  videoPhone: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 430,
    overflow: 'hidden',
    backgroundColor: '#12060F',
  },
  videoRemoteImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  videoShade: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  videoOffBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  videoOffHalo: {
    width: 188,
    height: 188,
    borderRadius: 94,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 253, 248, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 248, 222, 0.18)',
    boxShadow: Platform.OS === 'web' ? '0 20px 44px rgba(0, 0, 0, 0.36)' : undefined,
  },
  videoOffAvatarRing: {
    width: 152,
    height: 152,
    borderRadius: 76,
    padding: 4,
  },
  videoOffAvatarInner: {
    flex: 1,
    borderRadius: 72,
    padding: 4,
    backgroundColor: '#FFFDF8',
    overflow: 'hidden',
  },
  videoOffAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 68,
  },
  videoOffIcon: {
    position: 'absolute',
    right: 17,
    bottom: 19,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDF8',
    borderWidth: 2,
    borderColor: '#CFB13D',
    boxShadow: Platform.OS === 'web' ? '0 10px 18px rgba(0, 0, 0, 0.24)' : undefined,
  },
  videoOffName: {
    marginTop: 28,
    color: '#FFF7EA',
    fontFamily: 'serif',
    fontSize: 31,
    fontWeight: '900',
    textAlign: 'center',
  },
  videoOffStatus: {
    marginTop: 7,
    color: '#E9D79D',
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  videoTopBar: {
    position: 'absolute',
    top: 16,
    left: 18,
    right: 18,
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  videoCircleButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 247, 244, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255, 247, 244, 0.42)',
    boxShadow: Platform.OS === 'web' ? '0 8px 20px rgba(23, 5, 18, 0.32)' : undefined,
  },
  videoTitleBlock: {
    flex: 1,
    justifyContent: 'center',
    marginHorizontal: 8,
  },
  videoName: {
    color: '#FFF7EA',
    fontFamily: 'serif',
    fontSize: 21,
    fontWeight: '900',
    ...(Platform.OS === 'web' ? { textShadow: '0px 2px 8px rgba(0, 0, 0, 0.42)' } : {
      textShadowColor: 'rgba(0, 0, 0, 0.42)',
      textShadowOffset: { width: 0, height: 2 },
      textShadowRadius: 8,
    }) as any,
  },
  videoTimerPill: {
    minWidth: 62,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 247, 244, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255, 247, 244, 0.46)',
  },
  videoTimer: {
    color: '#755D56',
    fontSize: 11,
    fontWeight: '900',
  },
  selfPreview: {
    position: 'absolute',
    top: 106,
    right: 16,
    width: 120,
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    elevation: 8,
  },
  selfPreviewOffContent: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selfPreviewAvatar: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 3,
    borderColor: '#D3B742',
  },
  selfPreviewOffBadge: {
    position: 'absolute',
    right: 12,
    bottom: 13,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4B0054',
    borderWidth: 2,
    borderColor: '#FFFDF8',
  },
  videoControlsTray: {
    position: 'absolute',
    left: 30,
    right: 30,
    bottom: 38,
    minHeight: 116,
    borderRadius: 36,
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 249, 242, 0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.34)',
    boxShadow: Platform.OS === 'web' ? '0 14px 30px rgba(18, 6, 15, 0.28)' : undefined,
  },
  videoControlItem: {
    width: 68,
    alignItems: 'center',
    gap: 8,
  },
  videoControlButton: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1ECE4',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  videoControlButtonActive: {
    backgroundColor: '#FFF1C2',
    borderWidth: 1,
    borderColor: '#D3B742',
  },
  videoEndButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#C90812',
    boxShadow: Platform.OS === 'web' ? '0 12px 22px rgba(201, 8, 18, 0.3)' : undefined,
  },
  videoControlLabel: {
    color: '#3E3440',
    fontSize: 13,
    fontWeight: '900',
    ...(Platform.OS === 'web' ? { textShadow: '0px 1px 4px rgba(255, 255, 255, 0.3)' } : {
      textShadowColor: 'rgba(255, 255, 255, 0.3)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 4,
    }) as any,
  },
  videoEndLabel: {
    color: '#B30005',
    fontSize: 13,
    fontWeight: '900',
  },
});
