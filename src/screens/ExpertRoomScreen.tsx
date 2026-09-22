import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  Pressable,
  View,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Share,
  Clipboard,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import GengalAvatar from '../components/GengalAvatar';
import { auth } from '../config/firebase';
import { useUser } from '../context/UserContext';
import {
  ExpertRoom,
  RoomEvent,
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
  tickRoomBilling,
} from '../services/expertRoomService';
import { useRoomVoice, VoiceRole } from '../hooks/useRoomVoice';
import { useRoomPresence } from '../hooks/useRoomPresence';
import ConnectionBanner from '../components/rooms/ConnectionBanner';
import {
  RoomHeader, RoomDock, RoomRail, RoomSheet, RoomChat, RoomGifts,
  FeedEntry, GiftTarget,
} from '../components/rooms/RoomChrome';
import { SpeakerSeat } from '../components/rooms/SpeakerSeat';
import { roomPalette, RoomTone } from '../theme/roomTheme';

/** Live audio stages read best dark: avatars and the speaking halo carry the
 *  eye. The rest of the app is light, which is why the shell is tone-aware. */
const TONE: RoomTone = 'dark';
const C = roomPalette(TONE);

interface Props {
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
  route?: { params?: { roomId?: string } };
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
  const [infoModal, setInfoModal] = useState<{ title: string; msg: string } | null>(null);
  const [hasJoined, setHasJoined] = useState(false);
  const [giftRecipient, setGiftRecipient] = useState<{ uid: string; name: string } | null>(null);
  const [spentInRoom, setSpentInRoom] = useState(0);
  const [sheet, setSheet] = useState<null | 'chat' | 'gift'>(null);
  const [seenChat, setSeenChat] = useState(0);

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
  const roleLabel = isHost ? 'Host' : isSpeaker ? 'Speaker' : 'Audience';
  const boyQueue = handRequests.filter((r) => r.gender === 'boy');
  const girlQueue = handRequests.filter((r) => r.gender === 'girl');

  // Chat and system notices share one feed, newest last.
  const chatEvents = events.filter((e) => ['chat', 'gift', 'stage_up', 'join'].includes(e.type));
  const feedEntries: FeedEntry[] = [...chatEvents].reverse().map((e, i) => (
    e.type === 'chat'
      ? {
          id: e.id ?? `c${i}`,
          kind: 'chat' as const,
          name: e.senderName,
          text: e.text ?? '',
          mine: e.senderUid === myUid,
        }
      : {
          id: e.id ?? `s${i}`,
          kind: 'system' as const,
          text:
            e.type === 'gift' ? `${e.senderName} sent ${e.giftName} to ${e.recipientName ?? 'the host'}`
            : e.type === 'stage_up' ? `${e.senderName} came up on stage`
            : `${e.senderName} joined`,
        }
  ));
  const unreadChat = Math.max(0, chatEvents.filter((e) => e.type === 'chat').length - seenChat);

  const giftTargets: GiftTarget[] = room
    ? [
        { uid: room.hostUid, nickname: room.hostNickname, avatarData: room.hostAvatarData },
        ...room.speakers
          .filter((sp) => sp.uid !== room.hostUid && sp.uid !== myUid)
          .map((sp) => ({ uid: sp.uid, nickname: sp.nickname, avatarData: sp.avatarData })),
      ].filter((t) => t.uid !== myUid)
    : [];

  // One line telling the user what this room is doing and what they can do.
  const dockHeadline = isHost
    ? 'You are hosting'
    : isOnStage ? 'You are on stage'
    : hasRaisedHand ? 'Hand raised'
    : 'Listening';
  const dockHint = isHost
    ? (boyQueue.length + girlQueue.length > 0
        ? `${boyQueue.length + girlQueue.length} waiting to come up`
        : 'Tap a seat to mute or remove a speaker')
    : isOnStage ? 'Tap your seat to step down'
    : hasRaisedHand ? 'The host will bring you up when a seat frees'
    : 'Raise a hand to ask for the mic';

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

  // Speakers, the host, and whoever is under review may talk; everyone listens.
  const isUnderReview = room?.reviewingUid === myUid;
  const voiceRole: VoiceRole = (isHost || isSpeaker || isUnderReview) ? 'broadcaster' : 'audience';
  const { toggleMic, micMuted } = useRoomVoice(roomId, voiceRole, !!room);

  // Occupancy that expires. `room.activeMemberCount` is a stored counter and
  // drifts upward whenever a client dies without running its leave path, so the
  // header reads the live heartbeat roster instead.
  const { liveCount, connection } = useRoomPresence({
    collectionName: 'expert_rooms',
    roomId,
    uid: myUid,
    nickname: myName,
    avatarData: myAvatarData,
    isHost,
    enabled: !!room,
  });

  // 1. Join room event
  useEffect(() => {
    if (!roomId || !room || hasJoined) return;
    setHasJoined(true);
    // A failed join leaves the user looking at a room they are not actually in
    // — no presence, no stage, no chat delivery. Say so rather than swallow it.
    joinRoom(roomId, myUid, myName, myAvatarData).catch((e: any) => {
      console.warn('[ExpertRoom] Join failed:', e?.message ?? e);
      showInfo('Could not join', 'We could not put you in this room. Please check your connection and try again.');
      goBack?.();
    });
    return () => {
      if (roomId) leaveRoom(roomId, myUid, myName).catch(() => {});
    };
  }, [roomId, !!room]);

  // 2. Per-minute billing. The host is being paid, so they are never charged;
  // the server enforces that too. Ticks every 15s and on unmount so the last
  // partial interval is collected.
  useEffect(() => {
    if (!roomId || !room || !hasJoined) return;
    if (isHost || !(room.ratePerMin > 0)) return;

    let stopped = false;
    let consecutiveFailures = 0;
    const tick = async () => {
      try {
        const result = await tickRoomBilling(roomId);
        if (stopped) return;
        consecutiveFailures = 0;
        setSpentInRoom((prev) => prev + (result.billedAmount || 0));
        if (result.hasInsufficientFunds) {
          stopped = true;
          showInfo('Out of coins', `This room costs ${room.ratePerMin} coins a minute. Top up to keep listening.`);
          // Unmounting runs the join effect's cleanup, which leaves the room and
          // flushes the final billing tick.
          goBack?.();
        }
      } catch (e: any) {
        console.warn('[ExpertRoom] Billing tick failed:', e?.message ?? e);
        if (stopped) return;
        consecutiveFailures += 1;
        // The server keeps accumulating unbilled seconds while we can't reach
        // it, so staying silent means the next successful tick lands as one
        // large unexplained deduction. Leave instead, and say why.
        if (consecutiveFailures >= 3) {
          stopped = true;
          showInfo(
            'Connection lost',
            'We could not keep your room billing up to date, so we have taken you out of the room. Please check your connection and rejoin.'
          );
          goBack?.();
        }
      }
    };

    tick();
    const id = setInterval(tick, 15000);
    return () => {
      stopped = true;
      clearInterval(id);
      // Final tick collects the remaining seconds.
      tickRoomBilling(roomId).catch(() => {});
    };
  }, [roomId, hasJoined, isHost, room?.ratePerMin]);

  useEffect(() => {
    if (sheet === 'chat') setSeenChat(chatEvents.filter((e) => e.type === 'chat').length);
  }, [sheet, chatEvents.length]);

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
    await acceptOnStage(roomId, uid, nickname, avatarData, gender)
      .catch((e: any) => showInfo('Could not add to stage', e?.message || 'Please try again.'));
  }, [roomId, room]);

  const handleDirectSeatJoin = useCallback(async (gender: 'boy' | 'girl') => {
    if (!roomId) return;
    setActionLoading(true);
    try {
      await acceptOnStage(roomId, myUid, myName, myAvatarData, gender);
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
    await removeFromStage(roomId, uid)
      .catch((e: any) => showInfo('Could not remove from stage', e?.message || 'Please try again.'));
  }, [roomId, room]);

  const handleToggleSpeakerMute = useCallback(async (uid: string) => {
    if (!roomId || !room || !isHost) return;
    await toggleMute(roomId, uid)
      .catch((e: any) => showInfo('Could not change mute', e?.message || 'Please try again.'));
  }, [roomId, room, isHost]);

  const handleSendChat = useCallback(async () => {
    if (!roomId || !chatText.trim()) return;
    const msg = chatText.trim();
    setChatText('');
    // Put the text back if it never left — clearing the box already told the
    // user it sent, so a silent failure loses what they wrote.
    await sendChatMessage(roomId, myUid, myName, myAvatarData, msg).catch((e: any) => {
      setChatText((current) => (current ? current : msg));
      showInfo('Message not sent', e?.message || 'Please check your connection and try again.');
    });
  }, [roomId, chatText, myUid, myName, myAvatarData]);

  const handleSendGift = useCallback(async (giftId: string) => {
    if (!roomId || !room || !giftRecipient) return;
    setSheet(null);
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
    await pushMatchConnect(roomId, myUid, myName, toUid, toName)
      .catch((e: any) => showInfo('Could not connect', e?.message || 'Please try again.'));
  }, [roomId, myUid, myName]);

  const handleMatchGuests = useCallback(async () => {
    if (!roomId || !boySpeaker || !girlSpeaker) return;
    await pushMatchConnect(
      roomId,
      boySpeaker.uid,
      boySpeaker.nickname,
      girlSpeaker.uid,
      girlSpeaker.nickname,
    ).catch((e: any) => showInfo('Could not match guests', e?.message || 'Please try again.'));
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
    await closeExpertRoom(roomId)
      .catch((e: any) => showInfo('Could not close room', e?.message || 'Please try again.'));
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
        <LinearGradient colors={[C.bg, '#220722', C.bg]} style={styles.phone}>

          <RoomHeader
            tone={TONE}
            eyebrow={`${room.tier} · ${room.language}`}
            title={room.topic}
            onBack={isHost ? handleEndRoom : (goBack ?? (() => {}))}
            watching={liveCount}
            right={
              <Pressable
                onPress={handleShareLink}
                accessibilityRole="button"
                accessibilityLabel="Share an invite to this room"
                style={({ pressed }) => [styles.headerAction, pressed && { opacity: 0.7 }]}
              >
                <MaterialIcons name="share" size={16} color={C.accent} />
              </Pressable>
            }
          />

          <ConnectionBanner state={connection} tone={TONE} />

          {/* ── Stage ── */}
          <View style={styles.stageArea}>
            <View style={styles.hostRow}>
              <SpeakerSeat
                tone={TONE}
                slot="host"
                size={82}
                occupant={{
                  uid: room.hostUid,
                  nickname: room.hostNickname,
                  avatarData: room.hostAvatarData,
                  isMuted: room.speakers.find((sp) => sp.uid === room.hostUid)?.isMuted,
                }}
                isYou={isHost}
                isHost
                isLive={!room.speakers.find((sp) => sp.uid === room.hostUid)?.isMuted}
                onPressOccupant={
                  isHost ? undefined : () => {
                    setGiftRecipient({ uid: room.hostUid, name: room.hostNickname });
                    setSheet('gift');
                  }
                }
              />
            </View>

            <View style={styles.guestRow}>
              {(['boy', 'girl'] as const).map((gender) => {
                const seated = gender === 'boy' ? boySpeaker : girlSpeaker;
                const iRaised = gender === 'boy' ? raisedBoy : raisedGirl;
                const queue = gender === 'boy' ? boyQueue : girlQueue;
                return (
                  <View key={gender} style={styles.guestCol}>
                    <SpeakerSeat
                      tone={TONE}
                      slot={gender}
                      occupant={seated ?? null}
                      isYou={seated?.uid === myUid}
                      isHost={false}
                      isLive={!!seated && !seated.isMuted}
                      onTake={seated || actionLoading ? undefined : () => handleDirectSeatJoin(gender)}
                      onPressOccupant={
                        seated
                          ? () => {
                              if (seated.uid === myUid) {
                                handleRemoveFromStage(seated.uid);
                              } else if (isHost) {
                                handleToggleSpeakerMute(seated.uid);
                              } else {
                                setGiftRecipient({ uid: seated.uid, name: seated.nickname });
                                setSheet('gift');
                              }
                            }
                          : undefined
                      }
                    />

                    {/* Waiting list for this seat, with the control that matters
                        to whoever is looking: bring up, or raise your hand. */}
                    {(queue.length > 0 || (!seated && !isHost)) && (
                      <View style={styles.queue}>
                        {queue.length > 0 && (
                          <Text style={styles.queueLabel} numberOfLines={1}>
                            {queue.length} waiting
                          </Text>
                        )}
                        {isHost && queue.length > 0 && (
                          <Pressable
                            onPress={() => {
                              const next = queue[0];
                              if (next) handleAcceptOnStage(next.uid, next.nickname, next.avatarData, gender);
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={`Bring ${queue[0]?.nickname ?? 'the next person'} up to this seat`}
                            style={({ pressed }) => [styles.queueBtn, pressed && { opacity: 0.7 }]}
                          >
                            <Text style={styles.queueBtnText}>Bring up</Text>
                          </Pressable>
                        )}
                        {!isHost && !seated && (
                          <Pressable
                            onPress={() => handleRaiseHand(gender)}
                            disabled={actionLoading}
                            accessibilityRole="button"
                            accessibilityLabel={iRaised ? 'Lower your hand' : 'Raise your hand for this seat'}
                            style={({ pressed }) => [
                              styles.queueBtn,
                              iRaised && styles.queueBtnActive,
                              pressed && { opacity: 0.7 },
                            ]}
                          >
                            <Text style={styles.queueBtnText}>{iRaised ? 'Waiting' : 'Raise hand'}</Text>
                          </Pressable>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>

            {topGifters.length > 0 && (
              <View style={styles.gifters}>
                <Text style={styles.giftersLabel}>Top gifters</Text>
                <View style={styles.giftersRow}>
                  {topGifters.slice(0, 3).map((g, i) => (
                    <View key={g.uid} style={styles.gifterChip}>
                      <Text style={styles.gifterRank}>{i + 1}</Text>
                      <GengalAvatar data={g.avatarData} size={20} />
                      <Text style={styles.gifterName} numberOfLines={1}>{g.nickname}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>

          {/* ── Action dock ── */}
          <RoomDock
            tone={TONE}
            eyebrow={roleLabel}
            headline={dockHeadline}
            hint={dockHint}
            meter={!isHost && room.ratePerMin > 0 ? { spent: spentInRoom, ratePerMin: room.ratePerMin } : null}
            action={
              isOnStage ? (
                <Pressable
                  onPress={() => handleRemoveFromStage(myUid)}
                  accessibilityRole="button"
                  accessibilityLabel="Leave the stage"
                  style={({ pressed }) => [styles.dockCta, pressed && { opacity: 0.75 }]}
                >
                  <MaterialIcons name="logout" size={18} color={C.accent} />
                  <Text style={styles.dockCtaText}>Step down</Text>
                </Pressable>
              ) : !isHost ? (
                <Pressable
                  onPress={() => handleRaiseHand(userGender)}
                  disabled={actionLoading}
                  accessibilityRole="button"
                  accessibilityLabel={hasRaisedHand ? 'Lower your hand' : 'Raise your hand to join the stage'}
                  style={({ pressed }) => [
                    styles.dockCta,
                    hasRaisedHand && styles.dockCtaActive,
                    pressed && { opacity: 0.75 },
                  ]}
                >
                  <MaterialIcons
                    name={hasRaisedHand ? 'back-hand' : 'front-hand'}
                    size={18}
                    color={hasRaisedHand ? C.onAccent : C.accent}
                  />
                  <Text style={[styles.dockCtaText, hasRaisedHand && { color: C.onAccent }]}>
                    {hasRaisedHand ? 'Waiting' : 'Raise hand'}
                  </Text>
                </Pressable>
              ) : null
            }
          />

          {/* ── Utility rail ── */}
          <RoomRail
            tone={TONE}
            items={[
              {
                key: 'chat',
                icon: 'chat-bubble-outline',
                label: 'Chat',
                badge: unreadChat,
                onPress: () => setSheet('chat'),
              },
              {
                key: 'gift',
                icon: 'gift',
                community: true,
                label: 'Gift',
                onPress: () => {
                  if (!giftRecipient) setGiftRecipient({ uid: room.hostUid, name: room.hostNickname });
                  setSheet('gift');
                },
              },
              {
                key: 'mic',
                icon: micMuted ? 'mic-off' : 'mic',
                label: micMuted ? 'Unmute' : 'Mute',
                active: micMuted,
                disabled: voiceRole !== 'broadcaster',
                onPress: toggleMic,
              },
              {
                key: 'review',
                icon: 'badge',
                label: 'My profile',
                onPress: handleReviewMe,
              },
              // Host-only. The handler existed but was wired to nothing, so the
              // one thing a matchmaking host is here to do had no button.
              ...(isHost ? [{
                key: 'match',
                icon: 'favorite' as const,
                label: 'Match them',
                disabled: !boySpeaker || !girlSpeaker,
                onPress: handleMatchGuests,
              }] : []),
            ]}
          />

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
                      style={[styles.connectBtn, actionLoading && { opacity: 0.5 }]}
                      disabled={actionLoading}
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
                <TouchableOpacity style={[styles.acceptMatchBtn, actionLoading && { opacity: 0.5 }]} disabled={actionLoading} onPress={handleAcceptMatch}>
                  <MaterialIcons name="chat" size={18} color="#4B0054" />
                  <Text style={styles.acceptMatchText}>START CHAT</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => roomId && clearPendingMatch(roomId).catch(() => {})}>
                  <Text style={styles.declineMatchText}>Maybe later</Text>
                </TouchableOpacity>
              </LinearGradient>
            </View>
          </Modal>

          {/* ── Chat and gift sheets ── */}
          <Modal visible={sheet === 'chat'} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <RoomSheet tone={TONE} title="Room chat" onClose={() => setSheet(null)} bottomInset={0}>
                <RoomChat
                  tone={TONE}
                  entries={feedEntries}
                  value={chatText}
                  onChange={setChatText}
                  onSend={handleSendChat}
                  scrollRef={feedRef}
                />
              </RoomSheet>
            </KeyboardAvoidingView>
          </Modal>

          <Modal visible={sheet === 'gift'} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
            <RoomSheet tone={TONE} title="Send a gift" onClose={() => setSheet(null)} bottomInset={0}>
              <RoomGifts
                tone={TONE}
                targets={giftTargets}
                selectedUid={giftRecipient?.uid ?? null}
                onSelectTarget={(uid) => {
                  const t = giftTargets.find((g) => g.uid === uid);
                  if (t) setGiftRecipient({ uid: t.uid, name: t.nickname });
                }}
                gifts={GIFTS}
                onSend={(g) => handleSendGift(g.id)}
              />
            </RoomSheet>
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
  headerAction: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.card, borderWidth: 1, borderColor: C.line,
  },
  stageArea: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, paddingHorizontal: 16 },
  hostRow: { alignItems: 'center' },
  guestRow: { flexDirection: 'row', justifyContent: 'center', gap: 34 },
  guestCol: { alignItems: 'center', gap: 8 },
  queue: { alignItems: 'center', gap: 5 },
  queueLabel: { color: C.inkFaint, fontSize: 10, fontWeight: '700' },
  queueBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    borderWidth: 1, borderColor: C.line, backgroundColor: C.card,
    minHeight: 30, justifyContent: 'center',
  },
  queueBtnActive: { borderColor: C.accent, backgroundColor: 'rgba(201,168,76,0.16)' },
  queueBtnText: { color: C.ink, fontSize: 10, fontWeight: '800' },
  gifters: { alignItems: 'center', gap: 6 },
  giftersLabel: {
    color: C.inkFaint, fontSize: 9, fontWeight: '800',
    letterSpacing: 1.1, textTransform: 'uppercase',
  },
  giftersRow: { flexDirection: 'row', gap: 8 },
  gifterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.line, maxWidth: 116,
  },
  gifterRank: { color: C.accent, fontSize: 10, fontWeight: '900' },
  gifterName: { color: C.inkSoft, fontSize: 10, fontWeight: '700', flexShrink: 1 },
  dockCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    minHeight: 46, paddingHorizontal: 16, borderRadius: 23,
    borderWidth: 1, borderColor: C.accent, backgroundColor: C.card,
  },
  dockCtaActive: { backgroundColor: C.accent, borderColor: C.accent },
  dockCtaText: { color: C.accent, fontSize: 13, fontWeight: '900' },

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


  // Triangular stage and seats

  // Separate Queues Panel




  // ── ZONE 2: FEED ───────────────────────────────────────────────────────

  // ── ZONE 3: ACTION BAR ─────────────────────────────────────────────────

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
