import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Modal,
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Share,
  Clipboard,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import GengalAvatar from '../components/GengalAvatar';
import { skeuo } from '../theme/skeuomorphic';
import { auth } from '../config/firebase';
import { useUser } from '../context/UserContext';
import {
  ExpertRoom,
  RoomEvent,
  SpeakerSlot,
  TopGifter,
  GIFTS,
  subscribeToRoom,
  subscribeToRoomEvents,
  subscribeToTopGifters,
  joinRoom,
  leaveRoom,
  raiseHand,
  lowerHand,
  acceptOnStage,
  removeFromStage,
  toggleMute,
  sendChatMessage,
  sendGiftInRoom,
  triggerProfileReview,
  clearProfileReview,
  pushMatchConnect,
  clearPendingMatch,
  closeExpertRoom,
  HandRequest,
  subscribeToHandRequests,
} from '../services/expertRoomService';
import { useGengalVoice } from '../hooks/useGengalVoice';

interface Props {
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
  route?: { params?: { roomId?: string } };
}

// Animated pulsing ring for the speaking host
function PulseRing({ size, color }: { size: number; color: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.7)).current;
  useEffect(() => {
    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.18, duration: 900, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 900, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0.15, duration: 900, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.7, duration: 900, useNativeDriver: true }),
        ]),
      ])
    ).start();
  }, []);
  return (
    <Animated.View
      style={{
        position: 'absolute',
        width: size + 16,
        height: size + 16,
        borderRadius: (size + 16) / 2,
        borderWidth: 3,
        borderColor: color,
        opacity,
        transform: [{ scale }],
      }}
    />
  );
}

export default function ExpertRoomScreen({ navigate, goBack, route }: Props) {
  const roomId = route?.params?.roomId;
  const { profile } = useUser();
  const myUid = auth.currentUser?.uid ?? '';
  const myName = profile?.nickname || profile?.username || 'You';
  const myAvatarData = profile?.avatarData;
  const myBio = profile?.bio || '';
  const userGender: 'boy' | 'girl' =
    (profile?.gender?.toLowerCase() === 'female' || profile?.gender?.toLowerCase() === 'feminine')
      ? 'girl'
      : 'boy';

  const [room, setRoom] = useState<ExpertRoom | null>(null);
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [topGifters, setTopGifters] = useState<TopGifter[]>([]);
  const [handRequests, setHandRequests] = useState<HandRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [chatText, setChatText] = useState('');
  const [giftModal, setGiftModal] = useState(false);
  const [infoModal, setInfoModal] = useState<{ title: string; msg: string } | null>(null);
  const [hasJoined, setHasJoined] = useState(false);
  const [giftRecipient, setGiftRecipient] = useState<{ uid: string; name: string } | null>(null);

  const feedRef = useRef<ScrollView>(null);

  const isHost = room?.hostUid === myUid;
  const isSpeaker = room?.speakers.some((s) => s.uid === myUid) ?? false;

  // Separate Boy and Girl hand requests
  const raisedBoy = handRequests.some((r) => r.uid === myUid && r.gender === 'boy');
  const raisedGirl = handRequests.some((r) => r.uid === myUid && r.gender === 'girl');
  const hasRaisedHand = raisedBoy || raisedGirl;

  const isOnStage = room?.speakers.some((s) => s.uid === myUid && s.uid !== room?.hostUid) ?? false;
  const boySpeaker = room?.speakers?.find((s) => s.gender === 'boy');
  const girlSpeaker = room?.speakers?.find((s) => s.gender === 'girl');
  const speakerSlotsFilled = [boySpeaker, girlSpeaker].filter(Boolean).length;
  const audienceCount = Math.max((room?.activeMemberCount || 0) - (room?.speakers?.length || 0), 0);
  const roleLabel = isHost ? 'Host' : isSpeaker ? 'Speaker' : 'Audience';
  const roleTone = isHost ? '#D1B23B' : isSpeaker ? '#39BE69' : '#9BB4FF';
  const boyQueue = handRequests.filter((r) => r.gender === 'boy');
  const girlQueue = handRequests.filter((r) => r.gender === 'girl');

  // Review modal visible for everyone when reviewingUid is set
  const reviewVisible = !!room?.reviewingUid;
  // Match connect card — visible for the two matched users
  const matchVisible =
    !!room?.pendingMatch &&
    (room.pendingMatch.fromUid === myUid || room.pendingMatch.toUid === myUid);

  useEffect(() => {
    if (!roomId) { setLoading(false); return; }
    const unsubRoom = subscribeToRoom(roomId, (r) => {
      setRoom(r);
      setLoading(false);
    });
    const unsubEvents = subscribeToRoomEvents(roomId, (evs) => {
      setEvents(evs);
      setTimeout(() => feedRef.current?.scrollToEnd?.({ animated: true }), 80);
    });
    const unsubGifters = subscribeToTopGifters(roomId, setTopGifters);
    const unsubRequests = subscribeToHandRequests(roomId, setHandRequests);
    return () => { unsubRoom(); unsubEvents(); unsubGifters(); unsubRequests(); };
  }, [roomId]);

  // Mark as joined once on first load
  const { connectSeat, disconnectSeat, changeRole, toggleMic, micMuted } = useGengalVoice('agora');
  const [agoraConnected, setAgoraConnected] = useState(false);

  // 1. Join room event
  useEffect(() => {
    if (!roomId || !room || hasJoined) return;
    setHasJoined(true);
    joinRoom(roomId, myUid, myName, myAvatarData).catch(() => {});
    return () => {
      if (roomId) leaveRoom(roomId, myUid, myName).catch(() => {});
    };
  }, [roomId, !!room]);

  // 2. Connect to Agora channel
  useEffect(() => {
    if (!roomId || !room || agoraConnected) return;

    let active = true;
    const initVoice = async () => {
      try {
        console.log("[ExpertRoom] Requesting Agora RTC token...");
        const response = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/v1/agora/generate-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId, uid: myUid }),
        });
        if (!response.ok) throw new Error("Failed to generate token");

        const credentials = await response.json();
        if (!active) return;

        const role = (isHost || isSpeaker) ? 'broadcaster' : 'audience';
        await connectSeat(roomId, credentials.token, myUid, role);
        setAgoraConnected(true);
        console.log(`[ExpertRoom] Agora connected successfully as ${role}`);
      } catch (err) {
        console.warn("[ExpertRoom] Agora voice channel connection failed:", err);
      }
    };

    initVoice();

    return () => {
      active = false;
      disconnectSeat();
    };
  }, [roomId, !!room]);

  // 3. Handle stage role transitions
  useEffect(() => {
    if (!agoraConnected) return;
    const isUnderReview = room?.reviewingUid === myUid;
    const targetRole = (isHost || isSpeaker || isUnderReview) ? 'broadcaster' : 'audience';
    console.log(`[ExpertRoom] Dynamic role transition to ${targetRole}`);
    changeRole(targetRole).catch(e => console.warn("Failed to switch Agora client role", e));
  }, [isHost, isSpeaker, room?.reviewingUid, agoraConnected]);

  const showInfo = (title: string, msg: string) => setInfoModal({ title, msg });

  const handleRaiseHand = useCallback(async (gender: 'boy' | 'girl') => {
    if (!roomId) return;
    setActionLoading(true);
    try {
      const alreadyRequested = gender === 'boy' ? raisedBoy : raisedGirl;
      if (alreadyRequested) {
        await lowerHand(roomId, myUid);
      } else {
        await raiseHand(roomId, myUid, myName, myAvatarData, gender);
      }
    } catch (e: any) {
      showInfo('Error', e.message);
    } finally {
      setActionLoading(false);
    }
  }, [roomId, raisedBoy, raisedGirl, myUid, myName, myAvatarData]);

  const handleAcceptOnStage = useCallback(async (uid: string, nickname: string, avatarData: any, gender: 'boy' | 'girl') => {
    if (!roomId || !room) return;
    await acceptOnStage(roomId, uid, nickname, avatarData, gender).catch(() => {});
  }, [roomId, room]);

  const handleDirectSeatJoin = useCallback(async (gender: 'boy' | 'girl') => {
    if (!roomId) return;
    setActionLoading(true);
    try {
      await acceptOnStage(roomId, myUid, myName, myAvatarData, gender);
      console.log(`[ExpertRoom] Direct stage join successful for gender: ${gender}`);
    } catch (e: any) {
      showInfo('Error', e.message || 'Failed to join stage directly.');
    } finally {
      setActionLoading(false);
    }
  }, [roomId, myUid, myName, myAvatarData]);

  const handleShareLink = useCallback(async () => {
    if (!roomId) return;
    const roomUrl = `https://gengal.app/expertroom?roomId=${roomId}`;
    Clipboard.setString(roomUrl);
    try {
      await Share.share({
        message: `Join my live GenGal room: ${roomUrl}`,
        url: roomUrl,
        title: 'GenGal Live Room'
      });
    } catch (error) {
      console.warn("Share failed:", error);
    }
  }, [roomId]);

  const handleRemoveFromStage = useCallback(async (uid: string) => {
    if (!roomId || !room) return;
    await removeFromStage(roomId, uid, room.speakers).catch(() => {});
  }, [roomId, room]);

  const handleToggleSpeakerMute = useCallback(async (uid: string) => {
    if (!roomId || !room || !isHost) return;
    await toggleMute(roomId, uid, room.speakers).catch(() => {});
  }, [roomId, room, isHost]);

  const handleSendChat = useCallback(async () => {
    if (!roomId || !chatText.trim()) return;
    const msg = chatText.trim();
    setChatText('');
    await sendChatMessage(roomId, myUid, myName, myAvatarData, msg).catch(() => {});
  }, [roomId, chatText, myUid, myName, myAvatarData]);

  const handleSendGift = useCallback(async (giftId: string) => {
    if (!roomId || !room || !giftRecipient) return;
    setGiftModal(false);
    setActionLoading(true);
    try {
      const gift = await sendGiftInRoom(
        roomId,
        myUid,
        myName,
        myAvatarData,
        giftRecipient.uid,
        giftRecipient.name,
        giftId,
      );
      showInfo('🎁 Gift Sent!', `You sent a ${gift.emoji} ${gift.name} to ${giftRecipient.name}!`);
    } catch (e: any) {
      showInfo('Error', e.message || 'Insufficient coins or error sending gift.');
    } finally {
      setActionLoading(false);
    }
  }, [roomId, room, myUid, myName, myAvatarData, giftRecipient]);

  const handleReviewMe = useCallback(async () => {
    if (!roomId || !room || !isHost) return;
    // Host triggers review for the first raised-hand user, or for themselves as demo
    const targetUid = room.handQueue[0] || myUid;
    const targetName = targetUid === myUid ? myName : `User`;
    await triggerProfileReview(roomId, targetUid, targetName, myAvatarData, myBio).catch(() => {});
  }, [roomId, room, isHost, myUid, myName, myAvatarData, myBio]);

  const handleConnectMatch = useCallback(async (toUid: string, toName: string) => {
    if (!roomId) return;
    await pushMatchConnect(roomId, myUid, myName, toUid, toName).catch(() => {});
  }, [roomId, myUid, myName]);

  const handleMatchGuests = useCallback(async () => {
    if (!roomId || !boySpeaker || !girlSpeaker) return;
    await pushMatchConnect(
      roomId,
      boySpeaker.uid,
      boySpeaker.nickname,
      girlSpeaker.uid,
      girlSpeaker.nickname,
    ).catch(() => {});
  }, [roomId, boySpeaker, girlSpeaker]);

  const handleAcceptMatch = useCallback(async () => {
    if (!roomId || !room?.pendingMatch) return;
    const match = room.pendingMatch;
    await clearPendingMatch(roomId).catch(() => {});
    navigate('Chat', {
      profileName: match.fromUid === myUid ? match.toName : match.fromName,
      targetUid: match.fromUid === myUid ? match.toUid : match.fromUid,
    });
  }, [roomId, room?.pendingMatch, myUid, navigate]);

  const handleEndRoom = async () => {
    if (!roomId) return;
    await closeExpertRoom(roomId).catch(() => {});
    goBack?.();
  };

  if (loading) {
    return (
      <ScreenShell tone="dark">
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#D49A0B" />
        </View>
      </ScreenShell>
    );
  }

  if (!room) {
    return (
      <ScreenShell tone="dark">
        <View style={styles.phone}>
          <View style={styles.center}>
            <MaterialIcons name="meeting-room" size={44} color="#D1B23B" />
            <Text style={styles.emptyTitle}>Room has ended</Text>
            <TouchableOpacity style={styles.backBtn} onPress={goBack}>
              <Text style={styles.backBtnText}>GO BACK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScreenShell>
    );
  }

  const tierColor = room.tier === 'VIP' ? '#9A1E8A' : room.tier === 'Advance' ? '#B99916' : '#4B6282';

  return (
    <ScreenShell tone="dark">
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <LinearGradient colors={['#12040E', '#2A0128', '#12040E']} style={styles.phone}>

          {/* ───── ZONE 1: THE STAGE ───── */}
          <View style={styles.stage}>
            {/* Header row */}
            <View style={styles.stageHeader}>
              <TouchableOpacity onPress={goBack} style={styles.exitBtn}>
                <MaterialIcons name="arrow-back-ios" size={18} color="#EADCA8" />
              </TouchableOpacity>
              <View style={styles.stageTopCenter}>
                <View style={[styles.langTag, { borderColor: tierColor }]}>
                  <Text style={[styles.langTagText, { color: tierColor }]}>{room.language}</Text>
                </View>
                <Text style={styles.stageTopicText} numberOfLines={1}>{room.topic}</Text>
              </View>
              <View style={styles.stageHeaderRight}>
                <TouchableOpacity onPress={handleShareLink} style={styles.shareHeaderBtn} activeOpacity={0.78}>
                  <MaterialIcons name="share" size={14} color="#EADCA8" />
                </TouchableOpacity>
                <View style={styles.livePill}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>LIVE</Text>
                </View>
                <Text style={styles.memberCount}>{room.activeMemberCount}</Text>
                <MaterialIcons name="people" size={13} color="#EADCA8" />
              </View>
            </View>

            
            <View style={styles.triangularStage}>
              {/* Host (Expert) Seat - Top Center */}
              <View style={styles.hostSeat}>
                <View style={styles.hostAvatarWrap}>
                  <PulseRing size={75} color="#D1B23B" />
                  <View style={styles.hostRing}>
                    <GengalAvatar data={room.hostAvatarData} size={75} />
                  </View>
                  <View style={styles.hostOnlineDot} />
                </View>
                <Text style={styles.hostName}>{room.hostNickname}</Text>
                <View style={[styles.hostBadge, { backgroundColor: tierColor }]}>
                  <MaterialIcons name="workspace-premium" size={10} color="#FFF" />
                  <Text style={styles.hostBadgeText}>EXPERT · {room.tier}</Text>
                </View>
              </View>

              {/* Guest Seats - Bottom Row */}
              <View style={styles.guestsRow}>
                {/* Boy Seat (Left) */}
                <View style={styles.guestSeat}>
                  {boySpeaker ? (
                    <View style={[styles.guestAvatarWrap, styles.goldenCircle]}>
                      <GengalAvatar data={boySpeaker.avatarData} size={65} />
                      <View style={styles.goldGenderBadge}>
                        <MaterialIcons name="male" size={10} color="#12040E" />
                      </View>
                      {boySpeaker.isMuted && (
                        <View style={styles.mutedBadge}>
                          <MaterialIcons name="mic-off" size={10} color="#FFF" />
                        </View>
                      )}
                      {isHost && (
                        <View style={styles.seatModRail}>
                          <TouchableOpacity style={styles.seatModBtn} onPress={() => handleToggleSpeakerMute(boySpeaker.uid)}>
                            <MaterialIcons name={boySpeaker.isMuted ? 'mic' : 'mic-off'} size={11} color="#FFF" />
                          </TouchableOpacity>
                          <TouchableOpacity style={[styles.seatModBtn, styles.removeSeatBtn]} onPress={() => handleRemoveFromStage(boySpeaker.uid)}>
                            <MaterialIcons name="close" size={12} color="#FFF" />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  ) : (
                    !isHost && !isSpeaker && userGender === 'boy' ? (
                      <TouchableOpacity
                        style={[styles.emptySeatCircle, styles.goldBorder]}
                        activeOpacity={0.7}
                        onPress={() => handleDirectSeatJoin('boy')}
                      >
                        <MaterialIcons name="male" size={32} color="#D1B23B" />
                      </TouchableOpacity>
                    ) : (
                      <View style={[styles.emptySeatCircle, styles.goldBorder]}>
                        <MaterialIcons name="male" size={32} color="#D1B23B" />
                      </View>
                    )
                  )}
                  <Text style={styles.guestName} numberOfLines={1}>
                    {boySpeaker ? boySpeaker.nickname : 'Boy Seat'}
                  </Text>
                  {!boySpeaker && (
                    !isHost && !isSpeaker && userGender === 'boy' ? (
                      <Text style={styles.joinSeatLabel}>+ Join</Text>
                    ) : (
                      <Text style={styles.emptyLabel}>Empty</Text>
                    )
                  )}
                </View>

                {/* Girl Seat (Right) */}
                <View style={styles.guestSeat}>
                  {girlSpeaker ? (
                    <View style={[styles.guestAvatarWrap, styles.goldenCircle]}>
                      <GengalAvatar data={girlSpeaker.avatarData} size={65} />
                      <View style={styles.goldGenderBadge}>
                        <MaterialIcons name="female" size={10} color="#12040E" />
                      </View>
                      {girlSpeaker.isMuted && (
                        <View style={styles.mutedBadge}>
                          <MaterialIcons name="mic-off" size={10} color="#FFF" />
                        </View>
                      )}
                      {isHost && (
                        <View style={styles.seatModRail}>
                          <TouchableOpacity style={styles.seatModBtn} onPress={() => handleToggleSpeakerMute(girlSpeaker.uid)}>
                            <MaterialIcons name={girlSpeaker.isMuted ? 'mic' : 'mic-off'} size={11} color="#FFF" />
                          </TouchableOpacity>
                          <TouchableOpacity style={[styles.seatModBtn, styles.removeSeatBtn]} onPress={() => handleRemoveFromStage(girlSpeaker.uid)}>
                            <MaterialIcons name="close" size={12} color="#FFF" />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  ) : (
                    !isHost && !isSpeaker && userGender === 'girl' ? (
                      <TouchableOpacity
                        style={[styles.emptySeatCircle, styles.goldBorder]}
                        activeOpacity={0.7}
                        onPress={() => handleDirectSeatJoin('girl')}
                      >
                        <MaterialIcons name="female" size={32} color="#D1B23B" />
                      </TouchableOpacity>
                    ) : (
                      <View style={[styles.emptySeatCircle, styles.goldBorder]}>
                        <MaterialIcons name="female" size={32} color="#D1B23B" />
                      </View>
                    )
                  )}
                  <Text style={styles.guestName} numberOfLines={1}>
                    {girlSpeaker ? girlSpeaker.nickname : 'Girl Seat'}
                  </Text>
                  {!girlSpeaker && (
                    !isHost && !isSpeaker && userGender === 'girl' ? (
                      <Text style={styles.joinSeatLabel}>+ Join</Text>
                    ) : (
                      <Text style={styles.emptyLabel}>Empty</Text>
                    )
                  )}
                </View>
              </View>
            </View>

            </View>

          {/* ───── ZONE 2: THE FEED (Absolute Overlay) ───── */}
          <ScrollView
            ref={feedRef}
            style={styles.feed}
            contentContainerStyle={styles.feedContent}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => feedRef.current?.scrollToEnd({ animated: true })}
          >
            {[...events].reverse().map((ev) => {
              if (ev.type === 'chat') {
                return (
                  <View key={ev.id} style={styles.chatRow}>
                    <View style={styles.chatAvatar}>
                      <GengalAvatar data={ev.senderAvatarData} size={28} />
                    </View>
                    <View style={styles.chatBubble}>
                      <Text style={styles.chatSender}>{ev.senderName}</Text>
                      <Text style={styles.chatText}>{ev.text}</Text>
                    </View>
                  </View>
                );
              }
              if (ev.type === 'gift') {
                if (!isHost && !isSpeaker) return null;
                const giftObj = GIFTS.find(g => g.name === ev.giftName);
                const toName = ev.recipientName || 'Host';
                return (
                  <View key={ev.id} style={styles.systemMsgRow}>
                    <Text style={styles.systemMsgGift}>
                      🎁 {ev.senderName} sent a {ev.giftName} {giftObj?.emoji ?? ''} to {toName}
                    </Text>
                  </View>
                );
              }
              if (ev.type === 'join') {
                if (!isHost && !isSpeaker) return null;
                return (
                  <View key={ev.id} style={styles.systemMsgRow}>
                    <Text style={styles.systemMsgJoin}>
                      👋 {ev.senderName} joined the room
                    </Text>
                  </View>
                );
              }
              if (ev.type === 'stage_up') {
                return (
                  <View key={ev.id} style={styles.systemMsgRow}>
                    <Text style={styles.systemMsgStage}>
                      🎙 {ev.senderName} is now on stage!
                    </Text>
                  </View>
                );
              }
              if (ev.type === 'raise_hand') {
                return (
                  <View key={ev.id} style={styles.systemMsgRow}>
                    <Text style={styles.systemMsgHand}>
                      ✋ {ev.senderName} raised hand ({ev.text})
                    </Text>
                  </View>
                );
              }
              if (ev.type === 'review') {
                return (
                  <View key={ev.id} style={styles.systemMsgRow}>
                    <Text style={styles.systemMsgReview}>
                      🔍 Reviewing {ev.senderName}'s profile
                    </Text>
                  </View>
                );
              }
              if (ev.type === 'match') {
                return (
                  <View key={ev.id} style={styles.systemMsgRow}>
                    <Text style={styles.systemMsgMatchText}>
                      💞 Match made in the room!
                    </Text>
                  </View>
                );
              }
              return null;
            })}
          </ScrollView>

          {/* ───── ZONE 3: ACTION BAR ───── */}
          <View style={styles.actionBar}>
            <View style={styles.chatInputWrap}>
              <TextInput
                style={styles.chatInput}
                placeholder="Say something..."
                placeholderTextColor="#A19891"
                value={chatText}
                onChangeText={setChatText}
                onSubmitEditing={handleSendChat}
                returnKeyType="send"
                maxLength={200}
              />
            </View>
            
            <TouchableOpacity
              style={[styles.actionIconRound, micMuted && styles.actionIconMuted]}
              onPress={toggleMic}
            >
              <MaterialIcons name={micMuted ? "mic-off" : "mic"} size={22} color={micMuted ? '#C9504B' : '#EADCA8'} />
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.actionIconRound}
              onPress={() => {
                if (room) {
                  setGiftRecipient({ uid: room.hostUid, name: room.hostNickname });
                  setGiftModal(true);
                }
              }}
            >
              <MaterialIcons name="card-giftcard" size={20} color="#D1B23B" />
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.actionIconRound, styles.exitAction]} 
              onPress={isHost ? handleEndRoom : goBack}
            >
              <MaterialIcons name="meeting-room" size={20} color="#C9504B" />
            </TouchableOpacity>
          </View>

          {/* ── Shared Profile Review Modal (all room members see this) ── */}
          <Modal visible={reviewVisible} transparent animationType="slide" onRequestClose={() => roomId && isHost && clearProfileReview(roomId)}>
            <View style={styles.reviewOverlay}>
              <View style={styles.reviewSheet}>
                <View style={styles.sheetHandle} />
                <Text style={styles.reviewLabel}>🔍 PROFILE REVIEW</Text>
                <Text style={styles.reviewSub}>The expert is reviewing this profile with the room</Text>

                <View style={styles.reviewAvatarWrap}>
                  <GengalAvatar data={room.reviewingAvatarData} size={80} />
                </View>
                <Text style={styles.reviewName}>{room.reviewingNickname}</Text>
                {!!room.reviewingBio && (
                  <Text style={styles.reviewBio}>{room.reviewingBio}</Text>
                )}

                {/* Host actions: dismiss or connect match */}
                {isHost ? (
                  <View style={styles.reviewHostActions}>
                    <TouchableOpacity
                      style={styles.connectBtn}
                      onPress={() => {
                        if (room.reviewingUid && room.reviewingNickname) {
                          handleConnectMatch(room.reviewingUid, room.reviewingNickname);
                        }
                        roomId && clearProfileReview(roomId).catch(() => {});
                      }}
                    >
                      <MaterialIcons name="favorite" size={16} color="#FFF" />
                      <Text style={styles.connectBtnText}>CONNECT MATCH</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.dismissBtn}
                      onPress={() => roomId && clearProfileReview(roomId).catch(() => {})}
                    >
                      <Text style={styles.dismissBtnText}>Dismiss</Text>
                    </TouchableOpacity>
                  </View>
                ) : room.reviewingUid === myUid ? (
                  <View style={styles.candidateReviewActions}>
                    <Text style={styles.candidateReviewWatchText}>You are under review! Speak to the room:</Text>
                    <TouchableOpacity
                      style={[styles.candidateMicBtn, micMuted && styles.candidateMicBtnMuted]}
                      onPress={toggleMic}
                      activeOpacity={0.8}
                    >
                      <LinearGradient
                        colors={micMuted ? ['#C9504B', '#A83B37'] : ['#9A1E8A', '#7A136D']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.candidateMicBtnInner}
                      >
                        <MaterialIcons name={micMuted ? "mic-off" : "mic"} size={20} color="#FFF" />
                        <Text style={styles.candidateMicBtnText}>
                          {micMuted ? "Unmute Microphone" : "Microphone Active"}
                        </Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={styles.reviewWatchText}>Listen to the expert's feedback…</Text>
                )}
              </View>
            </View>
          </Modal>

          {/* ── Private Match Connect Card ── */}
          <Modal visible={matchVisible} transparent animationType="fade" onRequestClose={() => roomId && clearPendingMatch(roomId).catch(() => {})}>
            <View style={styles.matchOverlay}>
              <LinearGradient colors={['#2A0128', '#4B0054']} style={styles.matchCard}>
                <Text style={styles.matchEmoji}>💞</Text>
                <Text style={styles.matchTitle}>You've Been Matched!</Text>
                <Text style={styles.matchSub}>
                  The expert thinks you and{' '}
                  <Text style={styles.matchName}>
                    {room.pendingMatch?.fromUid === myUid ? room.pendingMatch?.toName : room.pendingMatch?.fromName}
                  </Text>{' '}
                  could connect!
                </Text>
                <TouchableOpacity style={styles.acceptMatchBtn} onPress={handleAcceptMatch}>
                  <MaterialIcons name="chat" size={18} color="#4B0054" />
                  <Text style={styles.acceptMatchText}>START CHAT</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => roomId && clearPendingMatch(roomId).catch(() => {})}>
                  <Text style={styles.declineMatchText}>Maybe later</Text>
                </TouchableOpacity>
              </LinearGradient>
            </View>
          </Modal>

          {/* ── Gift Bottom Sheet ── */}
          <Modal visible={giftModal} transparent animationType="slide" onRequestClose={() => setGiftModal(false)}>
            <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setGiftModal(false)}>
              <View style={styles.giftSheet}>
                <View style={styles.sheetHandle} />
                <Text style={styles.giftSheetTitle}>Send a Gift</Text>

                {/* Recipient Selector */}
                <View style={styles.recipientSelectorRow}>
                  <TouchableOpacity
                    style={[styles.recipientChip, giftRecipient?.uid === room.hostUid && styles.recipientChipActive]}
                    onPress={() => setGiftRecipient({ uid: room.hostUid, name: room.hostNickname })}
                  >
                    <GengalAvatar data={room.hostAvatarData} size={22} />
                    <Text style={[styles.recipientText, giftRecipient?.uid === room.hostUid && styles.recipientTextActive]}>
                      Host ({room.hostNickname})
                    </Text>
                  </TouchableOpacity>

                  {boySpeaker && boySpeaker.uid !== myUid && (
                    <TouchableOpacity
                      style={[styles.recipientChip, giftRecipient?.uid === boySpeaker.uid && styles.recipientChipActive]}
                      onPress={() => setGiftRecipient({ uid: boySpeaker.uid, name: boySpeaker.nickname })}
                    >
                      <GengalAvatar data={boySpeaker.avatarData} size={22} />
                      <Text style={[styles.recipientText, giftRecipient?.uid === boySpeaker.uid && styles.recipientTextActive]}>
                        {boySpeaker.nickname} (♂)
                      </Text>
                    </TouchableOpacity>
                  )}

                  {girlSpeaker && girlSpeaker.uid !== myUid && (
                    <TouchableOpacity
                      style={[styles.recipientChip, giftRecipient?.uid === girlSpeaker.uid && styles.recipientChipActive]}
                      onPress={() => setGiftRecipient({ uid: girlSpeaker.uid, name: girlSpeaker.nickname })}
                    >
                      <GengalAvatar data={girlSpeaker.avatarData} size={22} />
                      <Text style={[styles.recipientText, giftRecipient?.uid === girlSpeaker.uid && styles.recipientTextActive]}>
                        {girlSpeaker.nickname} (♀)
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                <Text style={styles.giftSheetSub}>Coins are deducted instantly</Text>
                <View style={styles.giftGrid}>
                  {GIFTS.map((g) => (
                    <TouchableOpacity
                      key={g.id}
                      style={styles.giftItem}
                      activeOpacity={0.85}
                      onPress={() => handleSendGift(g.id)}
                    >
                      <Text style={styles.giftEmoji}>{g.emoji}</Text>
                      <Text style={styles.giftItemName}>{g.name}</Text>
                      <View style={styles.giftPriceRow}>
                        <MaterialIcons name="monetization-on" size={11} color="#F4A23A" />
                        <Text style={styles.giftItemPrice}>{g.cost}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </TouchableOpacity>
          </Modal>

          {/* ── Info Modal ── */}
          <Modal visible={!!infoModal} transparent animationType="fade" onRequestClose={() => setInfoModal(null)}>
            <View style={styles.infoOverlay}>
              <View style={styles.infoCard}>
                <Text style={styles.infoTitle}>{infoModal?.title}</Text>
                <Text style={styles.infoMsg}>{infoModal?.msg}</Text>
                <TouchableOpacity style={styles.infoBtn} onPress={() => setInfoModal(null)}>
                  <Text style={styles.infoBtnText}>OK</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          {actionLoading && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#D49A0B" />
            </View>
          )}
        </LinearGradient>
      </KeyboardAvoidingView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  iconBtnRound: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,253,248,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerLeft: {
    flex: 1,
    alignItems: 'flex-start',
  },
  actionIconRound: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,253,248,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  phone: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 430,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  emptyTitle: {
    color: '#EADCA8',
    fontFamily: 'serif',
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  backBtn: {
    backgroundColor: '#D1B23B',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
  },
  backBtnText: { color: '#2A0128', fontWeight: '900', fontSize: 13, letterSpacing: 2 },

  // ── ZONE 1: STAGE ──────────────────────────────────────────────────────
  stage: {
    paddingTop: Platform.OS === 'ios' ? 52 : 32,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  stageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  exitBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,253,248,0.08)',
  },
  stageTopCenter: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  langTag: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  langTagText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  stageTopicText: {
    color: '#EADCA8',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  stageHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    justifyContent: 'flex-end',
  },
  shareHeaderBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,253,248,0.08)',
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(57,190,105,0.15)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(57,190,105,0.3)',
  },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#39BE69' },
  liveText: { color: '#39BE69', fontSize: 9, fontWeight: '900' },
  memberCount: { color: '#EADCA8', fontSize: 11, fontWeight: '800' },
  roomConsole: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
    marginBottom: 14,
  },
  roleCard: {
    flex: 1.35,
    minHeight: 54,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: 'rgba(255,253,248,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(234,220,168,0.16)',
  },
  roleIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleCopy: {
    flex: 1,
  },
  roleLabel: {
    color: 'rgba(234,220,168,0.58)',
    fontSize: 8,
    fontWeight: '900',
  },
  roleValue: {
    color: '#FFFDF8',
    fontSize: 14,
    fontWeight: '900',
  },
  roomMetric: {
    flex: 0.75,
    minHeight: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,253,248,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(234,220,168,0.12)',
  },
  roomMetricValue: {
    color: '#EADCA8',
    fontSize: 14,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  roomMetricLabel: {
    color: 'rgba(234,220,168,0.52)',
    fontSize: 8,
    fontWeight: '800',
    textTransform: 'uppercase',
  },

  hostCenter: { alignItems: 'center', marginBottom: 10 },
  hostAvatarWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  hostRing: {
    width: 83,
    height: 83,
    borderRadius: 41.5,
    padding: 4,
    backgroundColor: '#D1B23B',
    boxShadow: Platform.OS === 'web' ? '0 0 24px rgba(209,178,59,0.5)' : undefined,
  },
  hostOnlineDot: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#39BE69',
    borderWidth: 2.5,
    borderColor: '#12040E',
  },
  hostName: {
    color: '#FFFDF8',
    fontFamily: 'serif',
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 4,
  },
  hostBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  hostBadgeText: { color: '#FFF', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },

  // Triangular stage and seats
  triangularStage: {
    alignItems: 'center',
    width: '100%',
    marginVertical: 10,
  },
  hostSeat: {
    alignItems: 'center',
  },
  guestsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    paddingHorizontal: 12,
    marginTop: 18,
  },
  guestSeat: {
    alignItems: 'center',
    width: 90,
    position: 'relative',
  },
  guestAvatarWrap: {
    position: 'relative',
    width: 73,
    height: 73,
    borderRadius: 36.5,
    padding: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,253,248,0.25)',
    backgroundColor: 'rgba(255,253,248,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptySeatCircle: {
    width: 65,
    height: 65,
    borderRadius: 32.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,253,248,0.03)',
    borderStyle: 'dashed',
    borderWidth: 2,
    marginBottom: 4,
  },
  goldBorder: { borderColor: 'rgba(209,178,59,0.7)' },
  seatModRail: {
    position: 'absolute',
    top: -8,
    right: -8,
    gap: 5,
  },
  seatModBtn: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#4B0054',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#12040E',
  },
  removeSeatBtn: {
    backgroundColor: '#C9504B',
  },
  guestName: {
    color: '#EADCA8',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 4,
    width: 80,
    textAlign: 'center',
  },
  emptyLabel: {
    color: 'rgba(255,253,248,0.25)',
    fontSize: 8,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  joinSeatLabel: {
    color: '#D1B23B',
    fontSize: 8,
    fontWeight: '900',
    textTransform: 'uppercase',
  },

  // Separate Queues Panel
  hostQueueContainer: {
    backgroundColor: 'rgba(255,253,248,0.02)',
    padding: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(209,178,59,0.1)',
    marginVertical: 8,
    width: '100%',
    gap: 10,
  },
  queueSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  queuePanelTitle: {
    color: '#FFFDF8',
    fontSize: 13,
    fontWeight: '900',
  },
  queuePanelSub: {
    color: 'rgba(234,220,168,0.58)',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  queueCountPill: {
    minWidth: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(209,178,59,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(209,178,59,0.34)',
  },
  queueCountText: {
    color: '#EADCA8',
    fontSize: 13,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  emptyQueueCard: {
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,253,248,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(234,220,168,0.10)',
  },
  emptyQueueText: {
    flex: 1,
    color: 'rgba(234,220,168,0.62)',
    fontSize: 10,
    fontWeight: '700',
  },
  audienceGuideCard: {
    minHeight: 58,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(155,180,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(155,180,255,0.20)',
    marginVertical: 8,
  },
  audienceGuideIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#9BB4FF',
  },
  audienceGuideCopy: {
    flex: 1,
  },
  audienceGuideTitle: {
    color: '#FFFDF8',
    fontSize: 12,
    fontWeight: '900',
  },
  audienceGuideSub: {
    color: 'rgba(234,220,168,0.62)',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 14,
  },
  boyText: { color: '#4A90E2' },
  girlText: { color: '#D0021B' },
  boyBg: { backgroundColor: 'rgba(74,144,226,0.12)', borderColor: 'rgba(74,144,226,0.3)' },
  girlBg: { backgroundColor: 'rgba(208,2,27,0.12)', borderColor: 'rgba(208,2,27,0.3)' },
  queueHeaderRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 4 },

  actionIconBoyActive: { backgroundColor: '#4A90E2', borderColor: '#4A90E2' },
  actionIconGirlActive: { backgroundColor: '#D0021B', borderColor: '#D0021B' },
  goldenCircle: {
    borderColor: '#D1B23B',
    borderWidth: 2.5,
    boxShadow: Platform.OS === 'web' ? '0 0 12px rgba(209,178,59,0.4)' : undefined,
  },
  goldGenderBadge: {
    position: 'absolute',
    bottom: -2,
    left: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#D1B23B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#12040E',
  },
  mutedBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#C9504B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#12040E',
  },
  speakerName: { color: '#EADCA8', fontSize: 10, fontWeight: '700', marginTop: 4, maxWidth: 60 },
  removeBtn: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#C9504B',
    alignItems: 'center',
    justifyContent: 'center',
  },

  queueRow: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  queueLabel: { color: '#EADCA8', fontSize: 10, fontWeight: '900' },
  acceptHandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#39BE69',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  acceptHandText: { color: '#FFF', fontSize: 10, fontWeight: '900' },
  reviewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,253,248,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(234,220,168,0.3)',
  },
  reviewBtnText: { color: '#EADCA8', fontSize: 10, fontWeight: '800' },

  leaderboard: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 6,
    backgroundColor: 'rgba(255,253,248,0.06)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  leaderTitle: { color: '#D1B23B', fontSize: 9, fontWeight: '900' },
  leaderItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  leaderRank: { color: '#D1B23B', fontSize: 9, fontWeight: '900' },
  leaderName: { color: '#EADCA8', fontSize: 9, fontWeight: '700', maxWidth: 50 },
  leaderCoins: { color: '#F4A23A', fontSize: 9, fontWeight: '900' },

  // ── ZONE 2: FEED ───────────────────────────────────────────────────────
  feed: {
    flex: 1,
    marginHorizontal: 12,
    marginVertical: 4,
    backgroundColor: 'transparent',
  },
  feedContent: {
    paddingHorizontal: 4,
    paddingVertical: 8,
    gap: 6,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginVertical: 2,
  },
  chatAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
  },
  chatBubble: {
    maxWidth: '85%',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 0,
  },
  chatSender: { color: '#D1B23B', fontSize: 11, fontWeight: '900', marginBottom: 1 },
  chatText: { color: '#F4EDE3', fontSize: 13, fontWeight: '500', lineHeight: 18 },
  systemMsgRow: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginVertical: 2,
  },
  systemMsgJoin: {
    color: '#A19891',
    fontSize: 11,
    fontWeight: '700',
  },
  systemMsgGift: {
    color: '#D1B23B',
    fontSize: 11,
    fontWeight: '900',
  },
  systemMsgStage: {
    color: '#39BE69',
    fontSize: 11,
    fontWeight: '800',
  },
  systemMsgHand: {
    color: '#4A90E2',
    fontSize: 11,
    fontWeight: '700',
  },
  systemMsgReview: {
    color: '#B99916',
    fontSize: 11,
    fontWeight: '800',
  },
  systemMsgMatchText: {
    color: '#F4A23A',
    fontSize: 11,
    fontWeight: '900',
  },

  // ── ZONE 3: ACTION BAR ─────────────────────────────────────────────────
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
    backgroundColor: '#12040E',
    borderTopWidth: 1,
    borderTopColor: 'rgba(209,178,59,0.12)',
  },
  chatInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,253,248,0.08)',
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(209,178,59,0.18)',
  },
  chatInput: {
    flex: 1,
    color: '#FFFDF8',
    fontSize: 14,
    fontWeight: '500',
    paddingVertical: 0,
  },
  sendBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#D1B23B',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,253,248,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,253,248,0.1)',
    gap: 2,
  },
  actionIconActive: {
    backgroundColor: '#D1B23B',
    borderColor: '#D1B23B',
  },
  actionIconMuted: {
    backgroundColor: 'rgba(201,80,75,0.15)',
    borderColor: 'rgba(201,80,75,0.3)',
  },
  actionIconLabel: { color: '#2A0128', fontSize: 7, fontWeight: '900' },
  exitAction: { backgroundColor: 'rgba(201,80,75,0.15)', borderColor: 'rgba(201,80,75,0.3)' },

  // ── Review Modal ──────────────────────────────────────────────────────
  reviewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(12,2,10,0.75)',
    justifyContent: 'flex-end',
  },
  reviewSheet: {
    backgroundColor: '#FFFDF8',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 40,
    alignItems: 'center',
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#DDD5CB',
    alignSelf: 'center',
    marginBottom: 16,
  },
  reviewLabel: {
    color: '#9A1E8A',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 4,
  },
  reviewSub: {
    color: '#8A7C70',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 18,
  },
  reviewAvatarWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    padding: 4,
    backgroundColor: '#D1B23B',
    marginBottom: 10,
  },
  reviewName: {
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 6,
  },
  reviewBio: {
    color: '#7F6808',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 18,
    paddingHorizontal: 12,
  },
  reviewHostActions: { flexDirection: 'row', gap: 12, width: '100%' },
  connectBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#9A1E8A',
  },
  connectBtnText: { color: '#FFF', fontSize: 13, fontWeight: '900', letterSpacing: 1 },
  dismissBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8F5EF',
    borderWidth: 1,
    borderColor: '#EEE4D8',
  },
  dismissBtnText: { color: '#7F6808', fontSize: 13, fontWeight: '800' },
  reviewWatchText: { color: '#A19891', fontSize: 13, fontWeight: '600', marginTop: 4 },

  // ── Match Card ────────────────────────────────────────────────────────
  matchOverlay: {
    flex: 1,
    backgroundColor: 'rgba(12,2,10,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  matchCard: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 28,
    padding: 28,
    alignItems: 'center',
    boxShadow: Platform.OS === 'web' ? '0 20px 40px rgba(0,0,0,0.5)' : undefined,
  },
  matchEmoji: { fontSize: 48, marginBottom: 10 },
  matchTitle: {
    color: '#FFFDF8',
    fontFamily: 'serif',
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 8,
  },
  matchSub: {
    color: '#EADCA8',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  matchName: { color: '#D1B23B', fontWeight: '900' },
  acceptMatchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#D1B23B',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 28,
    width: '100%',
    justifyContent: 'center',
    marginBottom: 12,
  },
  acceptMatchText: { color: '#2A0128', fontSize: 14, fontWeight: '900', letterSpacing: 2 },
  declineMatchText: { color: '#8A7C70', fontSize: 13, fontWeight: '600' },

  // ── Gift Sheet ────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(12,2,10,0.6)',
    justifyContent: 'flex-end',
  },
  giftSheet: {
    backgroundColor: '#FFFDF8',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 48,
  },
  giftSheetTitle: {
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 4,
  },
  giftSheetSub: {
    color: '#8A7C70',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 20,
  },
  giftGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'center',
  },
  giftItem: {
    width: 90,
    paddingVertical: 14,
    borderRadius: 20,
    alignItems: 'center',
    backgroundColor: '#F8F5EF',
    borderWidth: 1,
    borderColor: '#EEE4D8',
  },
  giftEmoji: { fontSize: 30, marginBottom: 6 },
  giftItemName: { color: '#4B0054', fontSize: 11, fontWeight: '800', textAlign: 'center', marginBottom: 4 },
  giftPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  giftItemPrice: { color: '#806806', fontSize: 12, fontWeight: '900' },

  // ── Info Modal ────────────────────────────────────────────────────────
  infoOverlay: {
    flex: 1,
    backgroundColor: 'rgba(12,2,10,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  infoCard: {
    width: '100%',
    maxWidth: 300,
    backgroundColor: '#FFFCF7',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
  },
  infoTitle: {
    color: '#4B0054',
    fontFamily: 'serif',
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 8,
  },
  infoMsg: {
    color: '#8A7C70',
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 18,
  },
  infoBtn: {
    width: '100%',
    height: 46,
    borderRadius: 23,
    backgroundColor: '#4B0054',
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoBtnText: { color: '#FFFDF8', fontSize: 14, fontWeight: '700' },

  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(12,2,10,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── FRND Matchmaking & Gifting Styles ──
  hostMatchThemBtn: {
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 10,
    borderRadius: 20,
    overflow: 'hidden',
  },
  hostMatchThemInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 6,
  },
  hostMatchThemText: {
    color: '#12040E',
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 0.5,
  },
  matchPendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 8,
    marginBottom: 8,
  },
  matchPendingText: {
    color: '#EADCA8',
    fontSize: 11,
    fontWeight: '600',
  },
  recipientSelectorRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
    marginBottom: 16,
    flexWrap: 'wrap',
    width: '100%',
  },
  recipientChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(234,220,168,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(234,220,168,0.25)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 5,
  },
  recipientChipActive: {
    backgroundColor: '#D1B23B',
    borderColor: '#D1B23B',
  },
  recipientText: {
    color: '#EADCA8',
    fontSize: 10,
    fontWeight: '700',
  },
  recipientTextActive: {
    color: '#12040E',
  },
  candidateReviewActions: {
    alignItems: 'center',
    width: '100%',
    marginTop: 10,
    gap: 12,
  },
  candidateReviewWatchText: {
    color: '#4B0054',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  candidateMicBtn: {
    borderRadius: 24,
    overflow: 'hidden',
    width: '100%',
    maxWidth: 240,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
  },
  candidateMicBtnMuted: {},
  candidateMicBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    gap: 8,
  },
  candidateMicBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
