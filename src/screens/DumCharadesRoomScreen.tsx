import React, {
  useState, useEffect, useRef, useCallback, useMemo,
} from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  KeyboardAvoidingView,
  Animated,
  Easing,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import GengalAvatar from '../components/GengalAvatar';
import ScreenShell from '../components/ScreenShell';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';
import { auth } from '../config/firebase';
import { useUser } from '../context/UserContext';
import {
  ChillRoom, ChillEvent,
  CHILL_GIFTS, pickRandomMovie,
  subscribeToChillRoom, subscribeToChillEvents,
  joinChillRoom, leaveChillRoom, closeChillRoom,
  startRound, beginActing, markCorrect, markTimeUp, resetToWaiting,
  sendChillChat, sendChillGuess, sendChillGift,
} from '../services/chillService';

interface Props {
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
  route?: { params?: { roomId?: string } };
}

// ── Confetti ──────────────────────────────────────────────────────────────────

function ConfettiPiece({ delay, color }: { delay: number; color: string }) {
  const y = useRef(new Animated.Value(-40)).current;
  const x = useRef(new Animated.Value(Math.random() * 300 - 150)).current;
  const rot = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(delay),
      Animated.parallel([
        Animated.timing(y, { toValue: 700, duration: 1800, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(rot, { toValue: 5, duration: 1800, easing: Easing.linear, useNativeDriver: true }),
        Animated.sequence([
          Animated.delay(1200),
          Animated.timing(opacity, { toValue: 0, duration: 600, useNativeDriver: true }),
        ]),
      ]),
    ]).start();
  }, []);

  const spin = rot.interpolate({ inputRange: [0, 5], outputRange: ['0deg', '1800deg'] });
  return (
    <Animated.View style={{
      position: 'absolute', top: 0, left: '50%',
      width: 10, height: 10, borderRadius: 2,
      backgroundColor: color,
      opacity,
      transform: [{ translateY: y }, { translateX: x }, { rotate: spin }],
    }} />
  );
}

const CONFETTI_COLORS = ['#F7DA55', '#C9504B', '#5EBB62', '#A78BF0', '#0891B2', '#FF8FA3'];

function Confetti({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: 28 }).map((_, i) => (
        <ConfettiPiece
          key={i}
          delay={i * 60}
          color={CONFETTI_COLORS[i % CONFETTI_COLORS.length]}
        />
      ))}
    </View>
  );
}

// ── Countdown ring ────────────────────────────────────────────────────────────

function CountdownRing({ seconds, total }: { seconds: number; total: number }) {
  const progress = useRef(new Animated.Value(1)).current;
  const pct = Math.max(0, seconds / total);
  const urgent = seconds <= 10;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: pct, duration: 1000, useNativeDriver: false,
    }).start();
  }, [pct]);

  const color = urgent ? '#C9504B' : '#D4B142';

  return (
    <View style={timerStyles.wrap}>
      <View style={[timerStyles.ring, urgent && timerStyles.ringUrgent]}>
        <Text style={[timerStyles.digits, urgent && timerStyles.digitsUrgent]}>
          {seconds}
        </Text>
        <Text style={timerStyles.unit}>sec</Text>
      </View>
      {urgent && <Text style={timerStyles.urgentLabel}>HURRY!</Text>}
    </View>
  );
}

const timerStyles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 4 },
  ring: {
    width: 76, height: 76, borderRadius: 38,
    borderWidth: 4, borderColor: '#D4B142',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(212,177,66,0.08)',
  },
  ringUrgent: { borderColor: '#C9504B', backgroundColor: 'rgba(201,80,75,0.1)' },
  digits: { color: '#D4B142', fontSize: 26, fontWeight: '900', fontFamily: 'serif' },
  digitsUrgent: { color: '#C9504B' },
  unit: { color: 'rgba(255,253,248,0.5)', fontSize: 9, fontWeight: '700', marginTop: -4 },
  urgentLabel: { color: '#C9504B', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
});

// ── Avatar Spotlight ──────────────────────────────────────────────────────────

function SpotlightAvatar({
  avatarData, name, role, color,
}: {
  avatarData?: any; name: string; role: string; color: string;
}) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.06, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <View style={spotStyles.wrap}>
      <Animated.View style={[spotStyles.ring, { borderColor: color }, { transform: [{ scale: pulse }] }]}>
        <GengalAvatar data={avatarData} size={64} />
      </Animated.View>
      <View style={[spotStyles.rolePill, { backgroundColor: color + '30', borderColor: color + '60' }]}>
        <Text style={[spotStyles.roleText, { color }]}>{role}</Text>
      </View>
      <Text style={spotStyles.name} numberOfLines={1}>{name}</Text>
    </View>
  );
}

const spotStyles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 5 },
  ring: {
    width: 78, height: 78, borderRadius: 39,
    borderWidth: 3, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,253,248,0.06)',
  },
  rolePill: {
    paddingHorizontal: 9, paddingVertical: 3,
    borderRadius: 10, borderWidth: 1,
  },
  roleText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  name: { color: '#FFFDF8', fontSize: 12, fontWeight: '900', maxWidth: 90 },
});

// ── Gift bar ──────────────────────────────────────────────────────────────────

function GiftBar({
  onGift,
  recipientUid,
  recipientName,
}: {
  onGift: (gift: typeof CHILL_GIFTS[0]) => void;
  recipientUid: string;
  recipientName: string;
}) {
  return (
    <View style={giftStyles.row}>
      {CHILL_GIFTS.map(g => (
        <TouchableOpacity
          key={g.id}
          style={giftStyles.btn}
          activeOpacity={0.78}
          onPress={() => onGift(g)}
        >
          <Text style={giftStyles.emoji}>{g.emoji}</Text>
          <Text style={giftStyles.cost}>{g.cost}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const giftStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, paddingHorizontal: 14 },
  btn: {
    flex: 1, alignItems: 'center', gap: 2,
    paddingVertical: 8, borderRadius: 12,
    backgroundColor: 'rgba(255,253,248,0.07)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  emoji: { fontSize: 18 },
  cost: { color: '#D4B142', fontSize: 9, fontWeight: '900' },
});

// ── Scoreboard widget ─────────────────────────────────────────────────────────

function Scoreboard({ scores, members }: { scores: Record<string, number>; members: { uid: string; nickname: string }[] }) {
  const sorted = useMemo(() =>
    [...members]
      .map(m => ({ ...m, score: scores[m.uid] ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5),
    [scores, members],
  );

  return (
    <View style={sbStyles.wrap}>
      <Text style={sbStyles.title}>Scoreboard</Text>
      {sorted.map((m, i) => (
        <View key={m.uid} style={sbStyles.row}>
          <Text style={sbStyles.rank}>#{i + 1}</Text>
          <Text style={sbStyles.name} numberOfLines={1}>{m.nickname}</Text>
          <Text style={sbStyles.score}>{m.score}</Text>
        </View>
      ))}
    </View>
  );
}

const sbStyles = StyleSheet.create({
  wrap: {
    marginHorizontal: 14, marginBottom: 12, borderRadius: 14,
    backgroundColor: 'rgba(255,253,248,0.05)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    padding: 12, gap: 6,
  },
  title: { color: '#D4B142', fontSize: 11, fontWeight: '900', letterSpacing: 0.5, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rank: { color: 'rgba(255,253,248,0.4)', fontSize: 10, fontWeight: '700', width: 20 },
  name: { flex: 1, color: '#FFFDF8', fontSize: 12, fontWeight: '700' },
  score: { color: '#D4B142', fontSize: 13, fontWeight: '900' },
});

// ── Chat feed event row ───────────────────────────────────────────────────────

function EventRow({ evt, myUid }: { evt: ChillEvent; myUid: string }) {
  if (evt.type === 'gift') {
    return (
      <View style={feedStyles.giftRow}>
        <Text style={feedStyles.giftText}>
          {evt.senderName} sent {evt.giftName} {CHILL_GIFTS.find(g => g.name === evt.giftName)?.emoji}
        </Text>
      </View>
    );
  }
  if (evt.type === 'round_start') {
    return <Text style={feedStyles.system}>— Round started! Actor: {evt.senderName} —</Text>;
  }
  if (evt.type === 'correct') {
    return <Text style={feedStyles.correct}>🎉 {evt.senderName} got it! Movie: {evt.movie}</Text>;
  }
  if (evt.type === 'round_end') {
    return <Text style={feedStyles.system}>— Time up! Movie was: {evt.movie} —</Text>;
  }
  if (evt.type === 'join') {
    return <Text style={feedStyles.join}>{evt.senderName} joined</Text>;
  }
  if (evt.type === 'guess') {
    return (
      <View style={feedStyles.guessRow}>
        <Text style={feedStyles.guessSender}>{evt.senderUid === myUid ? 'You' : evt.senderName}: </Text>
        <Text style={feedStyles.guessText}>🎯 {evt.text}</Text>
      </View>
    );
  }
  // chat
  return (
    <View style={feedStyles.chatRow}>
      <Text style={[feedStyles.chatSender, evt.senderUid === myUid && feedStyles.chatSenderMe]}>
        {evt.senderUid === myUid ? 'You' : evt.senderName}:{' '}
      </Text>
      <Text style={feedStyles.chatText}>{evt.text}</Text>
    </View>
  );
}

const feedStyles = StyleSheet.create({
  system: { color: 'rgba(255,253,248,0.4)', fontSize: 11, fontStyle: 'italic', textAlign: 'center', marginVertical: 3 },
  correct: { color: '#5EBB62', fontSize: 12, fontWeight: '900', textAlign: 'center', marginVertical: 4 },
  join: { color: 'rgba(255,253,248,0.3)', fontSize: 10, textAlign: 'center' },
  giftRow: {
    alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 4,
    borderRadius: 10, backgroundColor: 'rgba(212,177,66,0.12)',
    borderWidth: 1, borderColor: 'rgba(212,177,66,0.3)',
  },
  giftText: { color: '#D4B142', fontSize: 11, fontWeight: '700' },
  guessRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  guessSender: { color: '#A78BF0', fontSize: 11, fontWeight: '900' },
  guessText: { color: '#EADCA8', fontSize: 12, fontWeight: '600' },
  chatRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  chatSender: { color: '#D4B142', fontSize: 11, fontWeight: '900' },
  chatSenderMe: { color: '#A78BF0' },
  chatText: { color: '#EADCA8', fontSize: 12, flexShrink: 1 },
});

// ── Main Room Screen ──────────────────────────────────────────────────────────

export default function DumCharadesRoomScreen({ navigate, goBack, route }: Props) {
  const roomId = route?.params?.roomId ?? '';
  const { profile } = useUser();
  const myUid = auth.currentUser?.uid ?? '';
  const myName = profile?.nickname || profile?.username || 'Guest';
  const myAvatarData = profile?.avatarData;

  const [room, setRoom] = useState<ChillRoom | null>(null);
  const [events, setEvents] = useState<ChillEvent[]>([]);
  const [chatText, setChatText] = useState('');
  const [guessText, setGuessText] = useState('');
  const [inputMode, setInputMode] = useState<'chat' | 'guess'>('chat');
  const [sending, setSending] = useState(false);
  const [showGifts, setShowGifts] = useState(false);
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [confetti, setConfetti] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(45);
  const [hostPickingActor, setHostPickingActor] = useState(false);
  const chatRef = useRef<ScrollView>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isHost = room?.hostUid === myUid;
  const isActor = room?.actorUid === myUid;
  const isGuesser = room?.guesserUid === myUid;
  const isPlaying = room?.phase === 'acting' || room?.phase === 'prompt';

  // Members list derived from scores map
  const members = useMemo(() => {
    if (!room) return [];
    return Object.entries(room.scores).map(([uid]) => ({
      uid,
      nickname: uid === room.hostUid ? room.hostNickname
        : uid === room.actorUid ? (room.actorNickname ?? uid)
        : uid === room.guesserUid ? (room.guesserNickname ?? uid)
        : uid,
    }));
  }, [room]);

  // Subscribe to room
  useEffect(() => {
    if (!roomId) return;
    const unsub = subscribeToChillRoom(roomId, setRoom);
    return unsub;
  }, [roomId]);

  // Subscribe to events
  useEffect(() => {
    if (!roomId) return;
    const unsub = subscribeToChillEvents(roomId, (evts) => {
      setEvents([...evts].reverse());
    });
    return unsub;
  }, [roomId]);

  // Join on mount
  useEffect(() => {
    if (!roomId || !myUid) return;
    joinChillRoom(roomId, myUid, myName, myAvatarData);
    return () => {
      leaveChillRoom(roomId, myUid, myName);
    };
  }, [roomId]);

  // Auto-scroll chat
  useEffect(() => {
    chatRef.current?.scrollToEnd({ animated: true });
  }, [events]);

  // Show prompt popup when actor
  useEffect(() => {
    if (isActor && room?.phase === 'prompt' && room?.currentMovie) {
      setShowPrompt(true);
    } else {
      setShowPrompt(false);
    }
  }, [room?.phase, isActor]);

  // Countdown timer
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (room?.phase !== 'acting' || !room.timerEndsAt) return;

    const endsAt = room.timerEndsAt.toMillis();
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        if (isHost && room?.currentMovie) {
          markTimeUp(roomId, room.currentMovie);
        }
      }
    };
    tick();
    timerRef.current = setInterval(tick, 500);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [room?.phase, room?.timerEndsAt]);

  // Confetti on correct guess
  useEffect(() => {
    if (room?.phase === 'result' && room?.winnerUid) {
      setConfetti(true);
      const t = setTimeout(() => setConfetti(false), 2500);
      return () => clearTimeout(t);
    }
  }, [room?.phase, room?.winnerUid]);

  // ── Actions ──

  const handleSend = useCallback(async () => {
    const text = inputMode === 'guess' ? guessText : chatText;
    if (!text.trim() || !roomId) return;
    setSending(true);
    try {
      if (inputMode === 'guess') {
        await sendChillGuess(roomId, myUid, myName, myAvatarData, text.trim());
        setGuessText('');
      } else {
        await sendChillChat(roomId, myUid, myName, myAvatarData, text.trim());
        setChatText('');
      }
    } finally {
      setSending(false);
    }
  }, [inputMode, chatText, guessText, roomId, myUid, myName]);

  const handleGift = useCallback(async (gift: typeof CHILL_GIFTS[0]) => {
    if (!room?.actorUid || !roomId) return;
    setShowGifts(false);
    try {
      await sendChillGift(
        roomId, myUid, myName, myAvatarData,
        room.actorUid, gift.name, gift.cost,
      );
    } catch { /* insufficient coins */ }
  }, [room?.actorUid, roomId, myUid, myName]);

  const handleStartRound = useCallback(async (actorUid: string, actorNickname: string, actorAvatarData: any) => {
    if (!room || !roomId) return;
    const guesserUid = room.guesserUid ?? '';
    const movie = pickRandomMovie(room.language);
    await startRound(
      roomId,
      actorUid, actorNickname, actorAvatarData,
      guesserUid, room.guesserNickname ?? '', room.guesserAvatarData,
      movie, 45,
    );
    setHostPickingActor(false);
    // Begin acting after a brief prompt window
    setTimeout(() => beginActing(roomId), 4000);
  }, [room, roomId]);

  const handleMarkCorrect = useCallback(async (winnerUid: string, winnerName: string) => {
    if (!room?.currentMovie || !roomId) return;
    await markCorrect(roomId, winnerUid, winnerName, room.currentMovie, room.scores);
  }, [room, roomId]);

  const handleNextRound = useCallback(async () => {
    if (!roomId) return;
    await resetToWaiting(roomId);
  }, [roomId]);

  const handleLeave = useCallback(async () => {
    await leaveChillRoom(roomId, myUid, myName);
    if (isHost) await closeChillRoom(roomId);
    goBack?.();
  }, [roomId, myUid, myName, isHost]);

  if (!room) {
    return (
      <ScreenShell tone="dark">
        <View style={styles.loading}>
          <ActivityIndicator color="#D4B142" size="large" />
        </View>
      </ScreenShell>
    );
  }

  const phase = room.phase;

  return (
    <ScreenShell tone="dark">
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.phone}>
          <Confetti visible={confetti} />

          {/* ── Stage Header ── */}
          <LinearGradient colors={['#0D0010', '#2A0128']} style={styles.stageHeader}>
            <View style={styles.stageTop}>
              <TouchableOpacity onPress={handleLeave} style={styles.backBtn}>
                <MaterialIcons name="arrow-back" size={20} color="rgba(255,253,248,0.7)" />
              </TouchableOpacity>

              <View style={styles.stageCenter}>
                <View style={styles.livePill}>
                  <View style={styles.liveDot} />
                  <Text style={styles.livePillText}>DUMB CHARADES</Text>
                </View>
                <Text style={styles.roomLanguage}>{room.language}</Text>
              </View>

              <View style={styles.stageRight}>
                <TouchableOpacity onPress={() => setShowScoreboard(s => !s)} style={styles.iconBtn}>
                  <MaterialIcons name="leaderboard" size={20} color="#D4B142" />
                </TouchableOpacity>
                {members.length > 0 && (
                  <Text style={styles.memberCount}>{room.activeMemberCount}</Text>
                )}
              </View>
            </View>

            {/* ── Host avatar (top center) ── */}
            <View style={styles.hostRow}>
              <View style={styles.hostAvatarWrap}>
                <GengalAvatar data={room.hostAvatarData} size={50} />
                <View style={styles.hostBadge}>
                  <Text style={styles.hostBadgeText}>HOST</Text>
                </View>
              </View>
              <Text style={styles.hostName}>{room.hostNickname}</Text>
            </View>

            {/* ── Spotlight stage ── */}
            {(phase === 'prompt' || phase === 'acting' || phase === 'result') && (
              <View style={styles.spotlightRow}>
                {room.actorUid && (
                  <SpotlightAvatar
                    avatarData={room.actorAvatarData}
                    name={room.actorNickname ?? ''}
                    role="ACTOR"
                    color="#D4B142"
                  />
                )}

                {/* Timer in the middle */}
                {phase === 'acting' && (
                  <CountdownRing seconds={secondsLeft} total={room.timerSeconds} />
                )}
                {phase === 'prompt' && (
                  <View style={styles.promptBadge}>
                    <Text style={styles.promptBadgeText}>GET{'\n'}READY</Text>
                  </View>
                )}
                {phase === 'result' && (
                  <View style={styles.resultBadge}>
                    {room.winnerUid ? (
                      <>
                        <Text style={styles.resultEmoji}>🎉</Text>
                        <Text style={styles.resultLabel}>Correct!</Text>
                        <Text style={styles.resultWinner}>{room.winnerNickname}</Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.resultEmoji}>⏰</Text>
                        <Text style={styles.resultLabel}>Time up!</Text>
                      </>
                    )}
                  </View>
                )}

                {room.guesserUid && (
                  <SpotlightAvatar
                    avatarData={room.guesserAvatarData}
                    name={room.guesserNickname ?? ''}
                    role="GUESSER"
                    color="#A78BF0"
                  />
                )}
              </View>
            )}

            {/* Waiting stage */}
            {phase === 'waiting' && (
              <View style={styles.waitingRow}>
                <Text style={styles.waitingText}>
                  {room.activeMemberCount < 2
                    ? 'Waiting for players to join…'
                    : isHost ? 'Ready! Pick an actor to start.' : 'Waiting for host to start…'}
                </Text>
              </View>
            )}
          </LinearGradient>

          {/* ── Scoreboard (collapsible) ── */}
          {showScoreboard && members.length > 0 && (
            <Scoreboard scores={room.scores} members={members} />
          )}

          {/* ── Gift bar ── */}
          {phase === 'acting' && !isActor && (
            <View style={styles.giftSection}>
              <Text style={styles.giftLabel}>Send a gift to the Actor</Text>
              <GiftBar
                onGift={handleGift}
                recipientUid={room.actorUid ?? ''}
                recipientName={room.actorNickname ?? ''}
              />
            </View>
          )}

          {/* ── Host controls ── */}
          {isHost && (
            <View style={styles.hostControls}>
              {phase === 'waiting' && room.activeMemberCount >= 2 && (
                <TouchableOpacity
                  style={styles.controlBtn}
                  onPress={() => setHostPickingActor(true)}
                >
                  <MaterialIcons name="play-arrow" size={16} color="#FFF" />
                  <Text style={styles.controlBtnText}>Start Round</Text>
                </TouchableOpacity>
              )}
              {phase === 'acting' && (
                <>
                  <TouchableOpacity
                    style={[styles.controlBtn, styles.correctBtn]}
                    onPress={() => handleMarkCorrect(room.guesserUid ?? '', room.guesserNickname ?? '')}
                  >
                    <MaterialIcons name="check-circle" size={16} color="#FFF" />
                    <Text style={styles.controlBtnText}>Correct!</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.controlBtn, styles.skipBtn]}
                    onPress={() => room.currentMovie && markTimeUp(roomId, room.currentMovie)}
                  >
                    <MaterialIcons name="skip-next" size={16} color="#FFF" />
                    <Text style={styles.controlBtnText}>Skip</Text>
                  </TouchableOpacity>
                </>
              )}
              {phase === 'result' && (
                <TouchableOpacity style={styles.controlBtn} onPress={handleNextRound}>
                  <MaterialIcons name="replay" size={16} color="#FFF" />
                  <Text style={styles.controlBtnText}>Next Round</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* ── Chat / Guess feed ── */}
          <ScrollView
            ref={chatRef}
            style={styles.feed}
            contentContainerStyle={styles.feedContent}
            showsVerticalScrollIndicator={false}
          >
            {events.map((evt, i) => (
              <EventRow key={evt.id || i} evt={evt} myUid={myUid} />
            ))}
          </ScrollView>

          {/* ── Input bar ── */}
          <View style={styles.inputArea}>
            {/* Mode toggle — guess only available during acting phase */}
            <View style={styles.modeToggle}>
              <TouchableOpacity
                style={[styles.modeBtn, inputMode === 'chat' && styles.modeBtnActive]}
                onPress={() => setInputMode('chat')}
              >
                <Text style={[styles.modeBtnText, inputMode === 'chat' && styles.modeBtnTextActive]}>Chat</Text>
              </TouchableOpacity>
              {phase === 'acting' && !isActor && (
                <TouchableOpacity
                  style={[styles.modeBtn, styles.modeBtnGuess, inputMode === 'guess' && styles.modeBtnGuessActive]}
                  onPress={() => setInputMode('guess')}
                >
                  <Text style={[styles.modeBtnText, inputMode === 'guess' && styles.modeBtnTextActive]}>🎯 Guess</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder={inputMode === 'guess' ? 'Type your guess…' : 'Say something…'}
                placeholderTextColor="#6B5E52"
                value={inputMode === 'guess' ? guessText : chatText}
                onChangeText={inputMode === 'guess' ? setGuessText : setChatText}
                onSubmitEditing={handleSend}
                returnKeyType="send"
                maxLength={120}
              />
              <TouchableOpacity style={styles.sendBtn} onPress={handleSend} disabled={sending}>
                {sending
                  ? <ActivityIndicator size="small" color="#FFF" />
                  : <MaterialIcons name="send" size={16} color="#FFF" />}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* ── Actor Prompt Modal ── */}
      <Modal visible={showPrompt} transparent animationType="slide" onRequestClose={() => setShowPrompt(false)}>
        <View style={modalStyles.overlay}>
          <View style={modalStyles.card}>
            <MaterialIcons name="movie" size={36} color="#D4B142" />
            <Text style={modalStyles.title}>Your Movie</Text>
            <Text style={modalStyles.movie}>{room.currentMovie}</Text>
            <Text style={modalStyles.hint}>
              Don't say the name! Use actions, sounds, or clues.{'\n'}Guesser has to guess it!
            </Text>
            <TouchableOpacity style={modalStyles.btn} onPress={() => setShowPrompt(false)}>
              <Text style={modalStyles.btnText}>Got it — Let's Go! 🎬</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Host: Pick Actor Modal ── */}
      <Modal visible={hostPickingActor} transparent animationType="slide" onRequestClose={() => setHostPickingActor(false)}>
        <View style={modalStyles.overlay}>
          <View style={modalStyles.card}>
            <Text style={modalStyles.title}>Pick the Actor</Text>
            <Text style={modalStyles.hint}>Choose who will act out the movie clue.</Text>
            <ScrollView style={{ maxHeight: 280, width: '100%' }}>
              {members.filter(m => m.uid !== myUid).map(m => (
                <TouchableOpacity
                  key={m.uid}
                  style={modalStyles.memberRow}
                  onPress={() => handleStartRound(m.uid, m.nickname, null)}
                >
                  <Text style={modalStyles.memberName}>{m.nickname}</Text>
                  <MaterialIcons name="play-arrow" size={18} color="#D4B142" />
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={[modalStyles.btn, { marginTop: 14 }]} onPress={() => setHostPickingActor(false)}>
              <Text style={modalStyles.btnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScreenShell>
  );
}

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(13,0,16,0.85)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  card: {
    width: '100%', maxWidth: 340,
    backgroundColor: '#1A0714', borderRadius: 24,
    padding: 26, alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(212,177,66,0.3)',
  },
  title: { color: '#FFFDF8', fontSize: 22, fontWeight: '900', fontFamily: 'serif', marginVertical: 8 },
  movie: {
    color: '#D4B142', fontSize: 26, fontWeight: '900', fontFamily: 'serif',
    textAlign: 'center', marginBottom: 10, lineHeight: 32,
  },
  hint: { color: 'rgba(255,253,248,0.55)', fontSize: 12, fontWeight: '600', textAlign: 'center', lineHeight: 18, marginBottom: 20 },
  btn: {
    width: '100%', height: 48, borderRadius: 24,
    backgroundColor: '#5B0068', alignItems: 'center', justifyContent: 'center',
  },
  btnText: { color: '#FFFDF8', fontSize: 14, fontWeight: '900' },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 16,
    borderRadius: 12, marginBottom: 8,
    backgroundColor: 'rgba(255,253,248,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  memberName: { color: '#FFFDF8', fontSize: 14, fontWeight: '700' },
});

const styles = StyleSheet.create({
  phone: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: 430, backgroundColor: '#0D0010' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Stage header
  stageHeader: {
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(212,177,66,0.15)',
  },
  stageTop: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingTop: 52, paddingBottom: 10, gap: 8,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,253,248,0.07)',
  },
  stageCenter: { flex: 1, alignItems: 'center', gap: 2 },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10,
    backgroundColor: 'rgba(255,253,248,0.1)',
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#5EBB62' },
  livePillText: { color: '#FFFDF8', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  roomLanguage: { color: 'rgba(255,253,248,0.45)', fontSize: 10, fontWeight: '700' },
  stageRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,253,248,0.07)',
  },
  memberCount: { color: 'rgba(255,253,248,0.5)', fontSize: 10, fontWeight: '700' },

  // Host row
  hostRow: { alignItems: 'center', gap: 4, paddingBottom: 10 },
  hostAvatarWrap: { position: 'relative' },
  hostBadge: {
    position: 'absolute', bottom: -4, left: '50%', marginLeft: -16,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
    backgroundColor: '#5B0068', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  hostBadgeText: { color: '#FFFDF8', fontSize: 7, fontWeight: '900', letterSpacing: 0.5 },
  hostName: { color: 'rgba(255,253,248,0.65)', fontSize: 11, fontWeight: '700', marginTop: 8 },

  // Spotlight
  spotlightRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingHorizontal: 20, paddingVertical: 8,
  },
  promptBadge: {
    width: 70, height: 70, borderRadius: 35, borderWidth: 2, borderColor: '#D4B142',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(212,177,66,0.1)',
  },
  promptBadgeText: { color: '#D4B142', fontSize: 11, fontWeight: '900', textAlign: 'center', letterSpacing: 0.5 },
  resultBadge: {
    width: 76, alignItems: 'center', gap: 2,
  },
  resultEmoji: { fontSize: 28 },
  resultLabel: { color: '#FFFDF8', fontSize: 11, fontWeight: '900' },
  resultWinner: { color: '#D4B142', fontSize: 10, fontWeight: '700' },

  // Waiting
  waitingRow: { alignItems: 'center', paddingVertical: 16, paddingHorizontal: 24 },
  waitingText: { color: 'rgba(255,253,248,0.5)', fontSize: 13, fontWeight: '600', textAlign: 'center' },

  // Gift section
  giftSection: { paddingVertical: 8, gap: 6 },
  giftLabel: { color: 'rgba(255,253,248,0.4)', fontSize: 10, fontWeight: '700', letterSpacing: 0.5, paddingHorizontal: 14 },

  // Host controls
  hostControls: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingVertical: 8,
  },
  controlBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 14,
    backgroundColor: '#5B0068', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  correctBtn: { backgroundColor: '#1A6B33' },
  skipBtn: { backgroundColor: '#6B3B00' },
  controlBtnText: { color: '#FFFDF8', fontSize: 12, fontWeight: '900' },

  // Feed
  feed: { flex: 1, backgroundColor: '#0D0010' },
  feedContent: { padding: 12, gap: 6, paddingBottom: 16 },

  // Input
  inputArea: {
    backgroundColor: '#120018',
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)',
    paddingBottom: Platform.OS === 'ios' ? 28 : 12,
    paddingTop: 8,
  },
  modeToggle: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, marginBottom: 8 },
  modeBtn: {
    paddingHorizontal: 14, paddingVertical: 5, borderRadius: 12,
    backgroundColor: 'rgba(255,253,248,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  modeBtnActive: { backgroundColor: 'rgba(212,177,66,0.15)', borderColor: 'rgba(212,177,66,0.4)' },
  modeBtnGuess: { borderColor: 'rgba(167,139,240,0.3)' },
  modeBtnGuessActive: { backgroundColor: 'rgba(167,139,240,0.15)', borderColor: 'rgba(167,139,240,0.5)' },
  modeBtnText: { color: 'rgba(255,253,248,0.5)', fontSize: 11, fontWeight: '800' },
  modeBtnTextActive: { color: '#FFFDF8' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  input: {
    flex: 1, height: 42, borderRadius: 21, paddingHorizontal: 16,
    backgroundColor: 'rgba(255,253,248,0.07)',
    color: '#FFFDF8', fontSize: 13, fontWeight: '500',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#5B0068',
  },
});
