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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import GengalAvatar from '../components/GengalAvatar';
import BottomNav from '../components/BottomNav';
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
  sendChatMessage,
  sendGiftInRoom,
  triggerProfileReview,
  clearProfileReview,
  pushMatchConnect,
  clearPendingMatch,
  closeExpertRoom,
} from '../services/expertRoomService';

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

  const [room, setRoom] = useState<ExpertRoom | null>(null);
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [topGifters, setTopGifters] = useState<TopGifter[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [chatText, setChatText] = useState('');
  const [giftModal, setGiftModal] = useState(false);
  const [infoModal, setInfoModal] = useState<{ title: string; msg: string } | null>(null);
  const [hasJoined, setHasJoined] = useState(false);

  const feedRef = useRef<ScrollView>(null);

  const isHost = room?.hostUid === myUid;
  const isSpeaker = room?.speakers.some((s) => s.uid === myUid) ?? false;
  const hasRaisedHand = room?.handQueue.includes(myUid) ?? false;
  const isOnStage = room?.speakers.some((s) => s.uid === myUid && s.uid !== room?.hostUid) ?? false;

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
    return () => { unsubRoom(); unsubEvents(); unsubGifters(); };
  }, [roomId]);

  // Mark as joined once on first load
  useEffect(() => {
    if (!roomId || !room || hasJoined) return;
    setHasJoined(true);
    joinRoom(roomId, myUid, myName, myAvatarData).catch(() => {});
    return () => {
      if (roomId) leaveRoom(roomId, myUid, myName).catch(() => {});
    };
  }, [roomId, !!room]);

  const showInfo = (title: string, msg: string) => setInfoModal({ title, msg });

  const handleRaiseHand = useCallback(async () => {
    if (!roomId) return;
    setActionLoading(true);
    try {
      if (hasRaisedHand) {
        await lowerHand(roomId, myUid);
      } else {
        await raiseHand(roomId, myUid, myName);
      }
    } catch (e: any) {
      showInfo('Error', e.message);
    } finally {
      setActionLoading(false);
    }
  }, [roomId, hasRaisedHand, myUid, myName]);

  const handleAcceptOnStage = useCallback(async (uid: string, nickname: string) => {
    if (!roomId || !room) return;
    await acceptOnStage(roomId, uid, nickname, null).catch(() => {});
  }, [roomId, room]);

  const handleRemoveFromStage = useCallback(async (uid: string) => {
    if (!roomId || !room) return;
    await removeFromStage(roomId, uid, room.speakers).catch(() => {});
  }, [roomId, room]);

  const handleSendChat = useCallback(async () => {
    if (!roomId || !chatText.trim()) return;
    const msg = chatText.trim();
    setChatText('');
    await sendChatMessage(roomId, myUid, myName, myAvatarData, msg).catch(() => {});
  }, [roomId, chatText, myUid, myName, myAvatarData]);

  const handleSendGift = useCallback(async (giftId: string) => {
    if (!roomId || !room) return;
    setGiftModal(false);
    setActionLoading(true);
    try {
      const gift = await sendGiftInRoom(roomId, myUid, myName, myAvatarData, room.hostUid, giftId);
      showInfo('🎁 Gift Sent!', `You sent a ${gift.emoji} ${gift.name} to ${room.hostNickname}!`);
    } catch (e: any) {
      showInfo('Error', e.message || 'Insufficient coins or error sending gift.');
    } finally {
      setActionLoading(false);
    }
  }, [roomId, room, myUid, myName, myAvatarData]);

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

  const tierColor = room.tier === 'VIP' ? '#9A1E8A' : room.tier === 'Elite' ? '#B99916' : '#4B6282';

  return (
    <ScreenShell tone="dark">
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.phone}>

          {/* ───── ZONE 1: THE STAGE ───── */}
          <LinearGradient colors={['#12040E', '#2A0128', '#12040E']} style={styles.stage}>
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
                <View style={styles.livePill}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>LIVE</Text>
                </View>
                <Text style={styles.memberCount}>{room.activeMemberCount}</Text>
                <MaterialIcons name="people" size={13} color="#EADCA8" />
              </View>
            </View>

            {/* Host avatar — centre stage with pulsing ring */}
            <View style={styles.hostCenter}>
              <View style={styles.hostAvatarWrap}>
                <PulseRing size={90} color="#D1B23B" />
                <View style={styles.hostRing}>
                  <GengalAvatar data={room.hostAvatarData} size={90} />
                </View>
                <View style={styles.hostOnlineDot} />
              </View>
              <Text style={styles.hostName}>{room.hostNickname}</Text>
              <View style={[styles.hostBadge, { backgroundColor: tierColor }]}>
                <MaterialIcons name="workspace-premium" size={10} color="#FFF" />
                <Text style={styles.hostBadgeText}>EXPERT · {room.tier}</Text>
              </View>
            </View>

            {/* Co-speakers row */}
            {room.speakers.length > 1 && (
              <View style={styles.speakersRow}>
                {room.speakers.filter((s) => s.uid !== room.hostUid).map((s) => (
                  <View key={s.uid} style={styles.speakerSlot}>
                    <View style={styles.speakerRing}>
                      <GengalAvatar data={s.avatarData} size={50} />
                      {s.isMuted && (
                        <View style={styles.mutedBadge}>
                          <MaterialIcons name="mic-off" size={10} color="#FFF" />
                        </View>
                      )}
                    </View>
                    <Text style={styles.speakerName} numberOfLines={1}>{s.nickname}</Text>
                    {isHost && (
                      <TouchableOpacity style={styles.removeBtn} onPress={() => handleRemoveFromStage(s.uid)}>
                        <MaterialIcons name="close" size={10} color="#FFF" />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* Hand queue — shown to host as accept buttons */}
            {isHost && room.handQueue.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.queueRow}>
                <Text style={styles.queueLabel}>RAISED HANDS: </Text>
                {room.handQueue.map((uid, i) => (
                  <TouchableOpacity
                    key={uid}
                    style={styles.acceptHandBtn}
                    onPress={() => handleAcceptOnStage(uid, `User ${i + 1}`)}
                  >
                    <MaterialIcons name="pan-tool" size={12} color="#FFF" />
                    <Text style={styles.acceptHandText}>Accept #{i + 1}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={styles.reviewBtn} onPress={handleReviewMe}>
                  <MaterialIcons name="rate-review" size={12} color="#EADCA8" />
                  <Text style={styles.reviewBtnText}>Review Profile</Text>
                </TouchableOpacity>
              </ScrollView>
            )}

            {/* Top Gifters leaderboard widget */}
            {topGifters.length > 0 && (
              <View style={styles.leaderboard}>
                <MaterialIcons name="emoji-events" size={12} color="#D1B23B" />
                <Text style={styles.leaderTitle}>TOP GIFTERS · </Text>
                {topGifters.slice(0, 3).map((g, i) => (
                  <View key={g.uid} style={styles.leaderItem}>
                    <Text style={styles.leaderRank}>#{i + 1}</Text>
                    <Text style={styles.leaderName} numberOfLines={1}>{g.nickname}</Text>
                    <MaterialIcons name="monetization-on" size={10} color="#F4A23A" />
                    <Text style={styles.leaderCoins}>{g.totalCoins}</Text>
                  </View>
                ))}
              </View>
            )}
          </LinearGradient>

          {/* ───── ZONE 2: THE FEED ───── */}
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
                return (
                  <View key={ev.id} style={styles.giftAnnounce}>
                    <Text style={styles.giftAnnounceText}>
                      🎁 <Text style={styles.giftAnnounceName}>{ev.senderName}</Text> sent a {ev.giftName} · {ev.giftCost} coins
                    </Text>
                  </View>
                );
              }
              if (ev.type === 'join') {
                return (
                  <Text key={ev.id} style={styles.systemMsg}>
                    👋 {ev.senderName} joined the room
                  </Text>
                );
              }
              if (ev.type === 'stage_up') {
                return (
                  <Text key={ev.id} style={styles.systemMsgHighlight}>
                    🎙 {ev.senderName} is now on stage!
                  </Text>
                );
              }
              if (ev.type === 'raise_hand') {
                return (
                  <Text key={ev.id} style={styles.systemMsg}>
                    ✋ {ev.senderName} raised their hand
                  </Text>
                );
              }
              if (ev.type === 'review') {
                return (
                  <Text key={ev.id} style={styles.systemMsgHighlight}>
                    🔍 Expert is reviewing {ev.senderName}'s profile
                  </Text>
                );
              }
              if (ev.type === 'match') {
                return (
                  <Text key={ev.id} style={styles.systemMsgMatch}>
                    💞 A match was made! Check your notifications.
                  </Text>
                );
              }
              return null;
            })}
          </ScrollView>

          {/* ───── ZONE 3: ACTION BAR ───── */}
          <View style={styles.actionBar}>
            {/* Text input */}
            <View style={styles.chatInputWrap}>
              <TextInput
                style={styles.chatInput}
                placeholder="Say something..."
                placeholderTextColor="#8A7C70"
                value={chatText}
                onChangeText={setChatText}
                onSubmitEditing={handleSendChat}
                returnKeyType="send"
                maxLength={200}
              />
              {chatText.length > 0 && (
                <TouchableOpacity onPress={handleSendChat} style={styles.sendBtn}>
                  <MaterialIcons name="send" size={18} color="#4B0054" />
                </TouchableOpacity>
              )}
            </View>

            {/* Raise Hand */}
            <TouchableOpacity
              style={[styles.actionIcon, hasRaisedHand && styles.actionIconActive]}
              onPress={handleRaiseHand}
              disabled={actionLoading || isHost}
            >
              <MaterialIcons name="pan-tool" size={22} color={hasRaisedHand ? '#4B0054' : '#EADCA8'} />
              {hasRaisedHand && <Text style={styles.actionIconLabel}>Waiting...</Text>}
            </TouchableOpacity>

            {/* Gift */}
            <TouchableOpacity
              style={styles.actionIcon}
              onPress={() => setGiftModal(true)}
              disabled={isHost}
            >
              <MaterialIcons name="card-giftcard" size={22} color="#D1B23B" />
            </TouchableOpacity>

            {/* Host: end room */}
            {isHost ? (
              <TouchableOpacity style={[styles.actionIcon, styles.exitAction]} onPress={handleEndRoom}>
                <MaterialIcons name="meeting-room" size={22} color="#C9504B" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.actionIcon, styles.exitAction]} onPress={goBack}>
                <MaterialIcons name="exit-to-app" size={22} color="#A19891" />
              </TouchableOpacity>
            )}
          </View>

          <BottomNav active="Club" navigate={navigate} />

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
                <Text style={styles.giftSheetTitle}>Send a Gift to {room.hostNickname}</Text>
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
        </View>
      </KeyboardAvoidingView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
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
    width: 36,
    justifyContent: 'flex-end',
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

  hostCenter: { alignItems: 'center', marginBottom: 10 },
  hostAvatarWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  hostRing: {
    width: 98,
    height: 98,
    borderRadius: 49,
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
    fontSize: 22,
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

  speakersRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 8,
  },
  speakerSlot: { alignItems: 'center', position: 'relative' },
  speakerRing: {
    width: 58,
    height: 58,
    borderRadius: 29,
    padding: 3,
    backgroundColor: 'rgba(209,178,59,0.4)',
    borderWidth: 2,
    borderColor: '#D1B23B',
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
    backgroundColor: '#0F0310',
  },
  feedContent: {
    padding: 12,
    gap: 6,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  chatAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
  },
  chatBubble: {
    maxWidth: '78%',
    backgroundColor: 'rgba(75,0,84,0.45)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(209,178,59,0.15)',
  },
  chatSender: { color: '#D1B23B', fontSize: 11, fontWeight: '900', marginBottom: 1 },
  chatText: { color: '#F4EDE3', fontSize: 13, fontWeight: '500', lineHeight: 18 },
  giftAnnounce: {
    alignSelf: 'center',
    backgroundColor: 'rgba(154,30,138,0.2)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(154,30,138,0.4)',
  },
  giftAnnounceText: { color: '#F4EDE3', fontSize: 12, fontWeight: '700' },
  giftAnnounceName: { color: '#D1B23B', fontWeight: '900' },
  systemMsg: { color: '#8A7C70', fontSize: 11, fontWeight: '600', textAlign: 'center' },
  systemMsgHighlight: { color: '#EADCA8', fontSize: 11, fontWeight: '800', textAlign: 'center' },
  systemMsgMatch: { color: '#D1B23B', fontSize: 12, fontWeight: '900', textAlign: 'center' },

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
});
