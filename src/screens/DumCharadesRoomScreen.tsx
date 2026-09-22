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
  Pressable,
  View,
  KeyboardAvoidingView,
  Animated,
  Easing,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { tap42 } from '../theme/touch';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import GengalAvatar from '../components/GengalAvatar';
import { Alert } from '../components/CustomAlert';
import ScreenShell from '../components/ScreenShell';
import { useActionLock } from '../hooks/useActionLock';
import { skeuo, skeuoGradients } from '../theme/skeuomorphic';
import { auth } from '../config/firebase';
import { useUser } from '../context/UserContext';
import { useRoomVoice, VoiceRole } from '../hooks/useRoomVoice';
import { useRoomPresence } from '../hooks/useRoomPresence';
import ConnectionBanner from '../components/rooms/ConnectionBanner';
import { RoomHeader, RoomDock, RoomSheet, RoomGifts } from '../components/rooms/RoomChrome';
import { roomPalette, RoomTone } from '../theme/roomTheme';
import {
  subscribeToRoundAnswer,
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

/** Matches the audio rooms: a live stage reads best dark. */
const TONE: RoomTone = 'dark';
const C = roomPalette(TONE);

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
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [confetti, setConfetti] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(45);
  const [hostPickingActor, setHostPickingActor] = useState(false);
  // Round transitions write shared game state, so a double-tap would score
  // twice or skip a round for everyone in the room.
  const { locked: roundBusy, run: runRound } = useActionLock();
  const chatRef = useRef<ScrollView>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isHost = room?.hostUid === myUid;
  const isActor = room?.actorUid === myUid;
  const isGuesser = room?.guesserUid === myUid;

  // Charades is played out loud: the actor describes and the guesser answers, so
  // both need a live mic. The host keeps one to run the round. Everyone else
  // listens. Previously this screen had no voice at all.
  const voiceRole: VoiceRole =
    (isHost || isActor || isGuesser) ? 'broadcaster' : 'audience';
  const { toggleMic, micMuted, toggleSpeaker, speakerOn, error: voiceError } =
    useRoomVoice(roomId, voiceRole, !!room);

  // The answer is no longer on the room document. Only the actor and the host
  // can read it; for everyone else this subscription errors and stays null,
  // which is the point.
  const [roundAnswer, setRoundAnswer] = useState<string | null>(null);
  const [giftSheet, setGiftSheet] = useState(false);
  const [giftTargetUid, setGiftTargetUid] = useState<string | null>(null);
  useEffect(() => {
    if (!roomId || !(isActor || isHost)) { setRoundAnswer(null); return; }
    return subscribeToRoundAnswer(roomId, setRoundAnswer);
  }, [roomId, isActor, isHost]);

  const isPlaying = room?.phase === 'acting' || room?.phase === 'prompt';

  // Who is actually in the room right now.
  //
  // This was derived from the `scores` map, which nothing ever removes from —
  // so the scoreboard and the actor picker listed everyone who had *ever*
  // joined, and showed a raw Firestore uid for anyone who wasn't currently the
  // host, actor or guesser. The heartbeat roster carries real nicknames and
  // ages people out when they leave.
  const { members: presentMembers, liveCount, connection } = useRoomPresence({
    collectionName: 'chill_rooms',
    roomId,
    uid: myUid,
    nickname: myName,
    avatarData: myAvatarData,
    isHost,
    enabled: !!room,
  });

  const members = useMemo(
    () => presentMembers.map((m) => ({ uid: m.uid, nickname: m.nickname })),
    [presentMembers],
  );

  // Everyone present except yourself. The actor leads the list and is the
  // default recipient, since that is who a round is usually thanking.
  const giftTargets = useMemo(
    () =>
      presentMembers
        .filter((m) => m.uid !== myUid)
        .sort((a, b) => Number(b.uid === room?.actorUid) - Number(a.uid === room?.actorUid))
        .map((m) => ({ uid: m.uid, nickname: m.nickname, avatarData: m.avatarData })),
    [presentMembers, myUid, room?.actorUid],
  );

  // Falls back to the actor, then to whoever is first, so the sheet always has
  // a valid recipient even if the selected person just left.
  const activeGiftTarget =
    giftTargets.find((t) => t.uid === giftTargetUid)?.uid
    ?? giftTargets.find((t) => t.uid === room?.actorUid)?.uid
    ?? giftTargets[0]?.uid
    ?? null;

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
    if (isActor && room?.phase === 'prompt' && roundAnswer) {
      setShowPrompt(true);
    } else {
      setShowPrompt(false);
    }
  }, [room?.phase, isActor, roundAnswer]);

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
        if (isHost && roundAnswer) {
          markTimeUp(roomId, roundAnswer);
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

  const handleGift = useCallback(async (gift: typeof CHILL_GIFTS[0], toUid: string) => {
    if (!roomId || !toUid) return;
    try {
      await sendChillGift(
        roomId, myUid, myName, myAvatarData,
        toUid, gift.name, gift.cost,
      );
    } catch (e: any) {
      // This spends coins. Swallowing the failure left the user unable to tell
      // whether the gift went and whether they were charged for it.
      Alert.alert(
        'Gift not sent',
        e?.message || 'You may not have enough coins. Nothing was charged.',
      );
    }
  }, [roomId, myUid, myName, myAvatarData]);

  const handleStartRound = useCallback((actorUid: string, actorNickname: string, actorAvatarData: any) => runRound(async () => {
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
  }), [room, roomId, runRound]);

  const handleMarkCorrect = useCallback((winnerUid: string, winnerName: string) => runRound(async () => {
    if (!roundAnswer || !roomId || !room) return;
    await markCorrect(roomId, winnerUid, winnerName, roundAnswer, room.scores);
  }), [room, roomId, roundAnswer, runRound]);

  const handleNextRound = useCallback(() => runRound(async () => {
    if (!roomId) return;
    await resetToWaiting(roomId);
  }), [roomId, runRound]);

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

          <RoomHeader
            tone={TONE}
            eyebrow={`Charades · ${room.language}`}
            title={
              phase === 'acting' ? 'Round in play'
              : phase === 'prompt' ? 'Getting ready'
              : phase === 'result' ? 'Round over'
              : 'Waiting to start'
            }
            onBack={handleLeave}
            watching={liveCount}
            right={
              <View style={styles.headerActions}>
                {voiceRole === 'broadcaster' && (
                  <Pressable
                    onPress={toggleMic}
                    accessibilityRole="button"
                    accessibilityLabel={micMuted ? 'Unmute your microphone' : 'Mute your microphone'}
                    accessibilityState={{ selected: micMuted }}
                    style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.7 }]}
                  >
                    <MaterialIcons
                      name={micMuted ? 'mic-off' : 'mic'}
                      size={18}
                      color={micMuted ? C.danger : C.accent}
                    />
                  </Pressable>
                )}
                <Pressable
                  onPress={toggleSpeaker}
                  accessibilityRole="button"
                  accessibilityLabel={speakerOn ? 'Turn the speaker off' : 'Turn the speaker on'}
                  style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.7 }]}
                >
                  <MaterialIcons
                    name={speakerOn ? 'volume-up' : 'volume-off'}
                    size={18}
                    color={speakerOn ? C.accent : C.inkFaint}
                  />
                </Pressable>
                <Pressable
                  onPress={() => setShowScoreboard((v) => !v)}
                  accessibilityRole="button"
                  accessibilityLabel="Show the scoreboard"
                  accessibilityState={{ selected: showScoreboard }}
                  style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.7 }]}
                >
                  <MaterialIcons name="leaderboard" size={18} color={C.accent} />
                </Pressable>
                {phase === 'acting' && !isActor && (
                  <Pressable
                    onPress={() => setGiftSheet(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Send a gift to the actor"
                    style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.7 }]}
                  >
                    <MaterialCommunityIcons name="gift" size={18} color={C.accent} />
                  </Pressable>
                )}
              </View>
            }
          />

          <ConnectionBanner state={connection} tone={TONE} />

          <LinearGradient colors={[C.bg, '#2A0128']} style={styles.stageHeader}>
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
                  {liveCount < 2
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

          {/* Tells everyone what the round is doing, and carries the host's
              next action. Previously only the host saw any control here, so
              players had no idea what a phase meant or what came next. */}
          <RoomDock
            tone={TONE}
            eyebrow={isActor ? 'You are acting' : isGuesser ? 'You are guessing' : isHost ? 'You are hosting' : 'Watching'}
            headline={
              phase === 'waiting'
                ? (liveCount < 2 ? 'Waiting for players' : 'Ready to start')
                : phase === 'prompt' ? 'Get ready'
                : phase === 'acting' ? (isActor ? 'Act it out' : 'Guess the movie')
                : room.winnerUid ? `${room.winnerNickname} got it` : 'Time up'
            }
            hint={
              phase === 'acting' && isActor ? 'No words, no spelling it out.'
              : phase === 'acting' ? 'Type your guess below.'
              : phase === 'result' && room.revealedMovie ? `It was ${room.revealedMovie}.`
              : phase === 'waiting' && !isHost ? 'The host picks who acts.'
              : null
            }
            action={
              isHost ? (
                phase === 'waiting' && liveCount >= 2 ? (
                  <Pressable
                    onPress={() => setHostPickingActor(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Pick an actor and start the round"
                    style={({ pressed }) => [styles.dockCta, pressed && { opacity: 0.75 }]}
                  >
                    <MaterialIcons name="play-arrow" size={18} color={C.onAccent} />
                    <Text style={styles.dockCtaText}>Start</Text>
                  </Pressable>
                ) : phase === 'acting' ? (
                  <View style={styles.dockPair}>
                    <Pressable
                      onPress={() => handleMarkCorrect(room.guesserUid ?? '', room.guesserNickname ?? '')}
                      disabled={roundBusy}
                      accessibilityRole="button"
                      accessibilityLabel="Mark the guess correct"
                      accessibilityState={{ disabled: roundBusy }}
                      style={({ pressed }) => [styles.dockCta, pressed && { opacity: 0.75 }, roundBusy && { opacity: 0.5 }]}
                    >
                      <MaterialIcons name="check" size={18} color={C.onAccent} />
                      <Text style={styles.dockCtaText}>Correct</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => roundAnswer && markTimeUp(roomId, roundAnswer)}
                      accessibilityRole="button"
                      accessibilityLabel="Skip this round"
                      style={({ pressed }) => [styles.dockGhost, pressed && { opacity: 0.75 }]}
                    >
                      <MaterialIcons name="skip-next" size={18} color={C.inkSoft} />
                    </Pressable>
                  </View>
                ) : phase === 'result' ? (
                  <Pressable
                    onPress={handleNextRound}
                    disabled={roundBusy}
                    accessibilityRole="button"
                    accessibilityLabel="Start the next round"
                    accessibilityState={{ disabled: roundBusy }}
                    style={({ pressed }) => [styles.dockCta, pressed && { opacity: 0.75 }, roundBusy && { opacity: 0.5 }]}
                  >
                    <MaterialIcons name="replay" size={18} color={C.onAccent} />
                    <Text style={styles.dockCtaText}>Next</Text>
                  </Pressable>
                ) : null
              ) : null
            }
          />

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
              <TouchableOpacity
                style={styles.sendBtn}
                hitSlop={tap42}
                onPress={handleSend}
                disabled={sending}
                accessibilityRole="button"
                accessibilityLabel="Send your guess"
                accessibilityState={{ disabled: sending }}
              >
                {sending
                  ? <ActivityIndicator size="small" color="#FFF" />
                  : <MaterialIcons name="send" size={16} color="#FFF" />}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={giftSheet} transparent animationType="slide" onRequestClose={() => setGiftSheet(false)}>
        <RoomSheet tone={TONE} title="Send a gift" onClose={() => setGiftSheet(false)} bottomInset={0}>
          <RoomGifts
            tone={TONE}
            // Anyone actually in the room, not just the actor — the roster is
            // real now, so there is no reason to limit who can be thanked.
            targets={giftTargets}
            selectedUid={activeGiftTarget}
            onSelectTarget={setGiftTargetUid}
            gifts={CHILL_GIFTS}
            onSend={(g) => {
              const full = CHILL_GIFTS.find((x) => x.id === g.id);
              if (full && activeGiftTarget) handleGift(full, activeGiftTarget);
              setGiftSheet(false);
            }}
          />
        </RoomSheet>
      </Modal>

      {/* ── Actor Prompt Modal ── */}
      <Modal visible={showPrompt} transparent animationType="slide" onRequestClose={() => setShowPrompt(false)}>
        <View style={modalStyles.overlay}>
          <View style={modalStyles.card}>
            <MaterialIcons name="movie" size={36} color="#D4B142" />
            <Text style={modalStyles.title}>Your Movie</Text>
            <Text style={modalStyles.movie}>{roundAnswer}</Text>
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerBtn: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.card, borderWidth: 1, borderColor: C.line,
  },
  dockPair: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dockCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    minHeight: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: C.accent,
  },
  dockCtaText: { color: C.onAccent, fontSize: 13, fontWeight: '900' },
  dockGhost: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.line, backgroundColor: C.card,
  },
  phone: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: 430, backgroundColor: '#0D0010' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Stage header
  stageHeader: {
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(212,177,66,0.15)',
  },

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

  // Host controls

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
