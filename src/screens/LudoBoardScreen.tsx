import { Alert } from '../components/CustomAlert';
import { useActionLock } from '../hooks/useActionLock';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';

import GengalAvatar from '../components/GengalAvatar';
import { LudoPawn } from '../components/ludo/LudoPawn';
import { LudoBoardSurface } from '../components/ludo/LudoBoardSurface';
import { LudoDie } from '../components/ludo/LudoDie';
import { PlayerSeat } from '../components/ludo/PlayerSeat';
import { explainLudoBusy } from '../components/ludo/LudoLobby';
import { BASE_ORIGIN, cellForPosition, PlayerColor } from './LudoConstants';
import { GEMS, ludo, ludoRadius, ludoType, numeric } from '../theme/ludoTheme';

import { useRoomVoice } from '../hooks/useRoomVoice';
import { auth } from '../config/firebase';
import { useUser } from '../context/UserContext';
import { useRoomPresence } from '../hooks/useRoomPresence';
import { isRoomLive } from '../services/presenceService';
import ConnectionBanner from '../components/rooms/ConnectionBanner';
import {
  LudoEvent, LudoPlayer, LudoRoom, TokenColor, LUDO_GIFTS,
  FINISHED_POSITION,
  subscribeToLudoRoom, subscribeToLudoEvents,
  joinLudoRoom, leaveLudoRoom,
  startGame, rollDice, moveToken, skipTurn, SKIP_GRACE_MS, closeLudoRoom,
  isPerMinute, ludoRate, payingPlayers, tickLudo,
  getLegalMoves,
  sendLudoChat, sendLudoGift,
  buyLudoTicket, placeLudoBet,
} from '../services/ludoService';

interface Props {
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
  route?: { params?: { roomId?: string } };
}

/** Seats sit at the corner of the board their colour occupies. */
/**
 * Where each player's card sits, derived from where their home actually is.
 *
 * This was a hand-written list, and every entry was wrong: red sat above the
 * blue corner, blue above green's, yellow below red's and green below
 * yellow's. Each player's card was pinned over somebody else's home, which is
 * the one thing a seat's position is supposed to tell you. Reading it off
 * BASE_ORIGIN means the seats cannot drift from the board again.
 */
const SEAT_LAYOUT: { color: PlayerColor; align: 'left' | 'right' }[][] =
  ([0, 9] as const).map((row) =>
    (Object.keys(BASE_ORIGIN) as PlayerColor[])
      .filter((color) => BASE_ORIGIN[color].y === row)
      .sort((a, b) => BASE_ORIGIN[a].x - BASE_ORIGIN[b].x)
      .map((color, i) => ({ color, align: i === 0 ? ('left' as const) : ('right' as const) })),
  );

const ROLL_COST = 15;
const BET_AMOUNT = 50;
/** Fallback only — a table stores its own ticketPrice. */
const DEFAULT_SEAT_PRICE = 50;

export default function LudoBoardScreen({ navigate, goBack, route }: Props) {
  const roomId = route?.params?.roomId ?? '';
  const { profile } = useUser();
  const myUid = auth.currentUser?.uid ?? '';
  const myName = profile?.nickname || profile?.username || 'Guest';
  const myAvatarData = profile?.avatarData;

  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  /**
   * undefined = still finding out, null = confirmed gone.
   *
   * These used to be the same value and the screen rendered it as the
   * loading spinner -- so a room that had been deleted, or a listener that
   * failed (subscribeToLudoRoom reports that as null on purpose), left the
   * player watching "Setting the table..." forever, with no way to tell
   * that the table was never coming.
   */
  const [room, setRoom] = useState<LudoRoom | null | undefined>(undefined);
  const [events, setEvents] = useState<LudoEvent[]>([]);
  const [chatText, setChatText] = useState('');
  const [rolling, setRolling] = useState(false);
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const [takingSeat, setTakingSeat] = useState<TokenColor | null>(null);
  // Our own roll, from the moment the server answers. The room document says
  // the same thing a beat later; the die should not wait for it.
  const [rolled, setRolled] = useState<number | null>(null);
  const [joinedAsSpectator, setJoinedAsSpectator] = useState(false);
  const [sheet, setSheet] = useState<null | 'chat' | 'gift'>(null);
  // One lock across every coin-moving control on this screen: taking a seat,
  // backing a colour and gifting all debit the same balance, so they must not
  // be able to overlap or double-fire.
  const { locked: coinBusy, run: runCoin } = useActionLock();
  const [giftTarget, setGiftTarget] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [seenCount, setSeenCount] = useState(0);

  const chatRef = useRef<ScrollView>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const captureFlash = useRef(new Animated.Value(0)).current;
  const lastCaptureId = useRef<string | null>(null);

  // Players talk, spectators listen. Gate on presence so members/{uid} exists
  // before the Agora mint (channel id is the room doc id).
  // Board sizing budget: header, seat rows, action dock, utility rail.
  const stripHeight = isPerMinute(room) && room?.phase === 'playing' ? 40 : 0;
  const CHROME = 52 + 64 * 2 + 118 + 56 + 26 + stripHeight;
  const boardSize = Math.max(
    204,
    Math.min(width - 28, height - insets.top - insets.bottom - CHROME, 396)
  );
  const cellSize = boardSize / 15;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub?.remove?.();
  }, []);

  // ── Room wiring ────────────────────────────────────────────────────────────
  useEffect(() => {
    // No room id is not "still loading" either: nothing will ever arrive.
    if (!roomId) {
      setRoom(null);
      return;
    }
    return subscribeToLudoRoom(roomId, setRoom);
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    return subscribeToLudoEvents(roomId, (evts) => setEvents([...evts].reverse()));
  }, [roomId]);

  const spectatorRef = useRef(false);
  useEffect(() => {
    if (!roomId || !myUid) return;
    joinLudoRoom(roomId, myUid, myName, myAvatarData).then(({ asSpectator: spec }) => {
      setJoinedAsSpectator(spec);
    });
    return () => { leaveLudoRoom(roomId, myUid, myName, spectatorRef.current); };
  }, [roomId, myUid]);

  const myPlayer = room?.players.find((p) => p.uid === myUid) ?? null;
  /** Seated players drive the turn clock; spectators only watch it. */
  const isSeated = Boolean(myPlayer);
  const isHost = room?.hostUid === myUid;
  // Whether we are watching follows the live seat list, not how we walked in.
  // It used to be fixed at entry, so somebody who came in to watch and then
  // paid for a seat stayed a spectator: dice dead on their own turn, "Watching"
  // in the dock, audience-only voice, and the seat never released on leaving.
  // The entry answer only stands in until the room document has loaded.
  const asSpectator = room ? !isSeated : joinedAsSpectator;
  spectatorRef.current = asSpectator;

  // Heartbeat for watcher count only — paid seats are not presence-driven.
  const { liveCount, connection } = useRoomPresence({
    collectionName: 'ludo_rooms',
    roomId,
    uid: myUid,
    nickname: myName,
    avatarData: myAvatarData,
    isHost,
    countField: 'presentCount',
    enabled: !!room && room.status === 'live',
  });

  const voiceEnabled =
    !!roomId && !!myUid && !!room && room.status === 'live' && connection === 'live';
  const { toggleMic, micMuted, toggleSpeaker, speakerOn } = useRoomVoice(
    roomId,
    asSpectator ? 'audience' : 'broadcaster',
    voiceEnabled,
  );

  // Closed tables must not keep players on a dead board with an open mic.
  // A per-minute table that ended on its own stays on screen to say why.
  useEffect(() => {
    if (room?.status === 'closed' && !isPerMinute(room)) goBack?.();
  }, [room?.status, room?.gameMode, goBack]);

  // A host who walks away without closing leaves the table 'live' for ever.
  // The lobby already hides those by the host's heartbeat; without the same
  // check here, anyone still on the screen sat at "0 of 4 seated" waiting for
  // a game nobody could start. Only before the game: once it is under way a
  // host's dropped connection must not end it for everybody else.
  const [abandoned, setAbandoned] = useState(false);
  useEffect(() => {
    if (!room || isHost || room.phase !== 'waiting') {
      setAbandoned(false);
      return;
    }
    const check = () => setAbandoned(!isRoomLive(room));
    check();
    const id = setInterval(check, 15_000);
    return () => clearInterval(id);
  }, [room, isHost]);

  const watcherCount = Math.max(0, liveCount - (room?.players.length ?? 0));
  const isMyTurn = !!myPlayer && myPlayer.color === room?.currentTurn;

  const perMinute = isPerMinute(room);
  const hostColour = room?.players.find((p) => p.uid === room.hostUid)?.color ?? null;
  /** No players left: the board waits for somebody to sit down. */
  const paused = perMinute && room?.phase === 'playing' && !!room?.emptySince;

  // Per-minute tables move on these calls: the minute's charge, a host who has
  // gone quiet, an empty table closing. The host's first one after coming
  // back also marks them as back at the table.
  useEffect(() => {
    if (!perMinute || room?.phase !== 'playing' || !(isSeated || isHost)) return;
    const beat = () => { tickLudo(roomId, true).catch(() => {}); };
    beat();
    const id = setInterval(beat, 15_000);
    return () => clearInterval(id);
  }, [perMinute, room?.phase, isSeated, isHost, roomId]);

  // Drives the "closes in m:ss" countdown on a paused table.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!paused) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [paused]);

  const legalMoveIds = useMemo(() => {
    if (!room || !isMyTurn || !room.diceRolled || room.diceValue === null) return [];
    return getLegalMoves(room.tokens, room.currentTurn, room.diceValue);
  }, [room, isMyTurn]);
  const legalSet = useMemo(() => new Set(legalMoveIds), [legalMoveIds]);

  // ── Turn clock ─────────────────────────────────────────────────────────────
  // The player on turn retires their own expired turn; the host covers for them
  // if they have dropped. Previously only the host could, so a host leaving
  // stalled the table permanently.
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!room?.turnStartedAt || room.phase !== 'playing' || paused) {
      setSecondsLeft(null);
      return;
    }
    const endsAt = room.turnStartedAt.toMillis() + room.turnTimeoutSecs * 1000;
    // Nobody should sit through the clock of a host whose turns are skipped.
    const benchedTurn = perMinute && !!room.hostBenched && room.currentTurn === hostColour;
    // Any seated player may ask; the server decides whether the turn has
    // really expired. Restricting it to the current player or the host
    // meant a host who walked away mid-turn froze the table for everyone.
    //
    // The server allows a grace period past zero, so the one request this used
    // to send at zero was always refused and nothing asked again: the table sat
    // at "0s left" until some unrelated write happened to nudge it. Ask once
    // the grace has passed, and keep asking until the turn really changes --
    // which re-runs this effect and starts a fresh clock.
    let askAt = benchedTurn ? 0 : endsAt + SKIP_GRACE_MS;
    let retryMs = 600;
    let tries = 0;
    let asking = false;
    const tick = () => {
      const now = Date.now();
      setSecondsLeft(Math.max(0, Math.ceil((endsAt - now) / 1000)));
      if (!isSeated || asking || now < askAt) return;
      asking = true;
      skipTurn(roomId)
        .then(() => { askAt = Infinity; })
        .catch(() => {
          // A refusal this early is almost always the two clocks disagreeing
          // by a moment, so the first few retries come quickly.
          askAt = Date.now() + retryMs;
          tries += 1;
          if (tries > 5) retryMs = Math.min(retryMs * 2, 5000);
        })
        .finally(() => { asking = false; });
    };
    tick();
    timerRef.current = setInterval(tick, 250);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [room?.currentTurn, room?.turnStartedAt, room?.phase, room?.hostBenched, paused, perMinute, hostColour, isSeated, roomId]);

  // A roll with nothing to move passes immediately instead of burning the clock.
  useEffect(() => {
    if (!room || !isMyTurn || !room.diceRolled || rolling) return;
    if (legalMoveIds.length > 0) return;
    const t = setTimeout(() => skipTurn(roomId, room).catch(() => {}), 900);
    return () => clearTimeout(t);
  }, [room, isMyTurn, legalMoveIds.length, rolling, roomId]);

  // ── Capture flash ──────────────────────────────────────────────────────────
  useEffect(() => {
    const last = [...events].reverse().find((e) => e.type === 'capture');
    if (!last) return;
    const id = last.id ?? `${last.senderUid}-${last.tokenId}`;
    if (lastCaptureId.current === id) return;
    lastCaptureId.current = id;
    if (reduceMotion) return;
    Animated.sequence([
      Animated.timing(captureFlash, { toValue: 1, duration: 120, useNativeDriver: true }),
      Animated.timing(captureFlash, { toValue: 0, duration: 420, useNativeDriver: true }),
    ]).start();
  }, [events, reduceMotion, captureFlash]);

  useEffect(() => {
    if (sheet === 'chat') setSeenCount(events.length);
  }, [sheet, events.length]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleRoll = useCallback(async () => {
    if (!room || !isMyTurn || room.diceRolled || rolling) return;

    if (room.gameMode === 'per_token') {
      if ((profile?.coins ?? 0) < ROLL_COST) {
        Alert.alert('Not enough coins', `You need ${ROLL_COST} coins to roll. Top up in the store.`);
        return;
      }
    }

    setRolling(true);
    try {
      // Fee (per_token) + die are applied server-side atomically. The die
      // tumbles for as long as this takes and no longer: there used to be a
      // half-second pause in front of it for show, on top of the round trip.
      setRolled(await rollDice(roomId, myUid, myName, myAvatarData, room));
    } catch (e: any) {
      // The clock can run out between the tap and the server. The board is
      // already showing whose turn it is now; a dialog about it only gets in
      // the way.
      if (!/not your turn|already rolled/i.test(e?.message ?? '')) {
        Alert.alert('Roll failed', e?.message || 'That roll did not go through. Try again.');
      }
    } finally {
      setRolling(false);
    }
  }, [room, isMyTurn, rolling, profile, roomId, myUid, myName, myAvatarData]);

  // A new turn (or the same player's next roll) starts from the room again.
  useEffect(() => { setRolled(null); }, [room?.currentTurn, room?.turnStartedAt]);

  const handleTokenPress = useCallback(async (tokenId: string) => {
    if (!room || busyToken || !room.diceRolled) return;
    setBusyToken(tokenId);
    try {
      await moveToken(roomId, myUid, myName, myAvatarData, tokenId, room);
    } catch (e: any) {
      Alert.alert('Move failed', e?.message || 'That move did not go through.');
    } finally {
      setBusyToken(null);
    }
  }, [room, busyToken, roomId, myUid, myName, myAvatarData]);

  // When the roll leaves nothing to decide -- one pawn can move, or every pawn
  // that can is sitting on the same square (a six with everyone still in the
  // yard, most often) -- make the move instead of waiting on a tap. Each of
  // those taps used to cost a turn's worth of thumb-hunting, and a missed one
  // cost the whole turn.
  const autoMoved = useRef<string | null>(null);
  useEffect(() => {
    if (!room || !isMyTurn || !room.diceRolled || rolling || busyToken || asSpectator) return;
    if (legalMoveIds.length === 0) return;
    const squares = new Set(
      legalMoveIds.map((id) => room.tokens.find((t) => t.id === id)?.position)
    );
    if (squares.size !== 1) return;
    const key = `${room.turnStartedAt?.toMillis?.() ?? ''}:${room.diceValue}`;
    if (autoMoved.current === key) return;
    // Long enough to see the die come down and which pawn it picked.
    const t = setTimeout(() => {
      autoMoved.current = key;
      handleTokenPress(legalMoveIds[0]);
    }, 650);
    return () => clearTimeout(t);
  }, [room, isMyTurn, rolling, busyToken, asSpectator, legalMoveIds, handleTokenPress]);

  const doTakeSeat = useCallback((color: TokenColor) => runCoin(async () => {
    if (!room) return;
    const price = room.ticketPrice ?? DEFAULT_SEAT_PRICE;
    setTakingSeat(color);
    try {
      await buyLudoTicket(roomId, myUid, myName, myAvatarData, price, room.hostUid, color);
    } catch (e: any) {
      if (explainLudoBusy(e, navigate)) return;
      Alert.alert('Could not take that seat', e?.message || 'Someone may have taken it first.');
    } finally {
      setTakingSeat(null);
    }
  }), [room, roomId, myUid, myName, myAvatarData, runCoin, navigate]);

  /**
   * A per-minute seat is free but the minutes are not, and sitting down
   * commits you to the game -- so both are said before the seat is taken.
   */
  const handleTakeSeat = useCallback((color: TokenColor) => {
    if (!room) return;
    if (!isPerMinute(room)) {
      const price = room.ticketPrice ?? DEFAULT_SEAT_PRICE;
      if ((profile?.coins ?? 0) < price) {
        Alert.alert('Not enough coins', `A seat costs ${price} coins. Top up in the store.`);
        return;
      }
      doTakeSeat(color);
      return;
    }
    const seated = payingPlayers(room).length + 1;
    const rate = ludoRate(room.terms, seated);
    const full = ludoRate(room.terms, 3);
    if ((profile?.coins ?? 0) < rate) {
      Alert.alert(
        'Not enough coins',
        `Playing costs ${rate} coins a minute. Top up in the store, then take a seat.`,
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Get coins', onPress: () => navigate('Coins') },
        ],
      );
      return;
    }
    Alert.alert(
      `Take the ${GEMS[color as PlayerColor].name} seat?`,
      `The seat is free. While you play you pay ${rate} coins a minute` +
        (seated < 3 && full > rate ? ` (${full} if the table fills)` : '') +
        `, at the start of each minute. Run out and you lose the seat.` +
        (room.terms?.winnerPrize ? ` The winner gets ${room.terms.winnerPrize} coins.` : '') +
        `\n\nYou can't join another table until this game ends.`,
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Take seat', onPress: () => doTakeSeat(color) },
      ],
    );
  }, [room, profile, doTakeSeat, navigate]);

  const handleBet = useCallback((color: TokenColor) => runCoin(async () => {
    if (!room) return;
    if ((profile?.coins ?? 0) < BET_AMOUNT) {
      Alert.alert('Not enough coins', `A backing costs ${BET_AMOUNT} coins.`);
      return;
    }
    try {
      await placeLudoBet(roomId, myUid, myName, color, BET_AMOUNT, room.hostUid);
    } catch (e: any) {
      Alert.alert('Bet failed', e?.message || 'That bet did not go through.');
    }
  }), [room, profile, roomId, myUid, myName, runCoin]);

  const handleStart = useCallback(() => runCoin(async () => {
    if (!room || !isHost) return;
    if (room.players.length < 2) {
      Alert.alert('Waiting for players', 'At least one more player needs to take a seat.');
      return;
    }
    try {
      await startGame(roomId);
    } catch (e: any) {
      Alert.alert('Could not start', e?.message || 'Try again in a moment.');
    }
  }), [room, isHost, roomId, runCoin]);

  const handleSendChat = useCallback(async () => {
    const text = chatText.trim();
    if (!text) return;
    setChatText('');
    try {
      await sendLudoChat(roomId, myUid, myName, myAvatarData, text);
    } catch {
      setChatText(text);
    }
  }, [chatText, roomId, myUid, myName, myAvatarData]);

  const handleGift = useCallback((gift: typeof LUDO_GIFTS[0]) => runCoin(async () => {
    if (!giftTarget) return;
    try {
      await sendLudoGift(roomId, myUid, myName, myAvatarData, giftTarget, gift.name, gift.cost);
      setSheet(null);
    } catch (e: any) {
      Alert.alert('Gift not sent', e?.message || `You need ${gift.cost} coins for that.`);
    }
  }), [giftTarget, roomId, myUid, myName, myAvatarData, runCoin]);

  const leaveNow = useCallback(async () => {
    await leaveLudoRoom(roomId, myUid, myName, spectatorRef.current);
    // A per-minute table is the server's to close: a host leaving mid-game
    // only steps away, and the game goes on without them.
    if (isHost && !isPerMinute(room)) await closeLudoRoom(roomId).catch(() => {});
    goBack?.();
  }, [roomId, myUid, myName, isHost, room, goBack]);

  const handleLeave = useCallback(() => {
    const live = room && isPerMinute(room) && room.status === 'live' && room.phase !== 'finished';
    if (!room || !live || asSpectator) { void leaveNow(); return; }
    const terms = room.terms;
    const deposit = terms?.deposit ?? 0;
    let title: string;
    let body: string;
    let cta = 'Leave';
    if (isHost && room.phase === 'waiting') {
      title = 'Close this table?';
      body = `Your ${deposit}-coin deposit comes back to you.`;
      cta = 'Close table';
    } else if (isHost && paused) {
      title = 'Go and invite friends?';
      body = `The board stays paused and leaving now does not count against you. ` +
        `The table ends if nobody sits down within ${Math.round((terms?.emptyCloseSecs ?? 300) / 60)} minutes of it emptying.`;
      cta = 'Leave for now';
    } else if (isHost) {
      const left = (terms?.hostMaxLeaves ?? 0) - (room.hostLeaves ?? 0);
      title = 'Leave the game?';
      if (room.hostBenched) {
        body = 'Your turns are already being skipped. The game carries on without you.';
      } else if (left > 0) {
        body = `The game carries on and your turns keep running. You can come back ${left} more time${left === 1 ? '' : 's'}.`;
      } else {
        title = 'That would be one too many';
        body = `You have used all ${terms?.hostMaxLeaves ?? 0} comebacks. Leave now and your turns are skipped ` +
          `for the rest of the game, and your ${deposit}-coin deposit goes to the players.`;
        cta = 'Leave anyway';
      }
    } else if (room.phase === 'waiting') {
      void leaveNow();
      return;
    } else {
      title = 'Leave the game?';
      body = "You lose your seat. You can't join another table until this game ends.";
      cta = 'Leave game';
    }
    Alert.alert(title, body, [
      { text: 'Stay', style: 'cancel' },
      { text: cta, style: 'destructive', onPress: () => { void leaveNow(); } },
    ]);
  }, [room, asSpectator, isHost, paused, leaveNow]);

  // A game that was played to the end keeps showing its results instead.
  const ended = !!room && isPerMinute(room) && room.status === 'closed'
    && room.settlement?.reason !== 'game_over';

  // ── Loading ────────────────────────────────────────────────────────────────
  if (room === null || abandoned || ended) {
    const reason = room?.settlement?.reason;
    const emptyMins = Math.round((room?.terms?.emptyCloseSecs ?? 300) / 60);
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.center}>
          <Text style={styles.goneTitle}>
            {ended && reason === 'empty_table' ? 'This table has ended'
              : abandoned || ended ? 'This table has closed' : 'This table is gone'}
          </Text>
          <Text style={styles.loadingText}>
            {ended && reason === 'empty_table'
              ? `Nobody sat down for ${emptyMins} minutes after everyone left, so the game ended.`
              : ended
                ? 'The host closed it before the game started.'
                : abandoned
                  ? 'The host left before the game started. Pick another table or open your own.'
                  : 'The game ended, or it could not be reached.'}
          </Text>
          <Pressable onPress={() => goBack?.()} style={styles.goneBtn} accessibilityRole="button">
            <Text style={styles.goneBtnText}>Back to games</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  if (room === undefined) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.center}>
          <ActivityIndicator color={ludo.ink} size="large" />
          <Text style={styles.loadingText}>Setting the table…</Text>
        </SafeAreaView>
      </View>
    );
  }

  // ── Derived view state ─────────────────────────────────────────────────────
  const byColor = Object.fromEntries(room.players.map((p) => [p.color, p])) as
    Partial<Record<TokenColor, LudoPlayer>>;

  const turnProgress = secondsLeft !== null && room.turnTimeoutSecs > 0
    ? Math.max(0, Math.min(1, secondsLeft / room.turnTimeoutSecs))
    : null;

  const isWaiting = room.phase === 'waiting';
  /** handleStart refuses below this, so the lobby must not imply otherwise. */
  const enoughToStart = room.players.length >= 2;
  /**
   * The host by uid. This used to read the player holding `currentTurn`, which
   * on a table that has not started is just the default colour -- so the card
   * could name somebody who is not the host at all.
   */
  const hostName = room.players.find((p) => p.uid === room.hostUid)?.nickname ?? 'The host';
  const isOver = room.phase === 'finished';

  const terms = room.terms;
  const paying = payingPlayers(room).length;
  const rateNow = ludoRate(terms, paying);
  const nextRate = ludoRate(terms, paying + 1);
  const myCoins = Math.floor(profile?.coins ?? 0);
  const canTakeSeat = !myPlayer && !isHost && (isWaiting || paused);
  const seatOffer = !canTakeSeat
    ? null
    : perMinute
      ? { text: `Free · ${nextRate}/min`, spoken: `free, then ${nextRate} coins a minute` }
      : { text: `${room.ticketPrice ?? DEFAULT_SEAT_PRICE} coins`, spoken: `${room.ticketPrice ?? DEFAULT_SEAT_PRICE} coins` };

  /** The one thing worth saying about a per-minute game right now, if any. */
  let notice: { icon: string; text: string; tone: 'info' | 'warn' } | null = null;
  if (perMinute && room.phase === 'playing') {
    const closeAt = (room.emptySince?.toMillis?.() ?? nowMs) + (terms?.emptyCloseSecs ?? 300) * 1000;
    const left = Math.max(0, Math.ceil((closeAt - nowMs) / 1000));
    const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    const deposit = terms?.deposit ?? 0;
    if (paused) {
      notice = {
        icon: 'pause-circle-outline',
        tone: 'warn',
        text: isHost
          ? `Paused. Invite friends; leaving now is free. Ends in ${clock}.`
          : `Paused until somebody sits down. Ends in ${clock}.`,
      };
    } else if (room.hostBenched) {
      notice = {
        icon: 'block',
        tone: 'warn',
        text: isHost
          ? 'Your turns are skipped. Your deposit goes to the players.'
          : `${hostName}'s turns are skipped. Their ${deposit}-coin deposit is shared at the end.`,
      };
    } else if (room.hostAway && !isHost) {
      notice = {
        icon: 'directions-walk',
        tone: 'info',
        text: `${hostName} stepped away (${room.hostLeaves ?? 0} of ${terms?.hostMaxLeaves ?? 0}). The game goes on.`,
      };
    } else if (isHost) {
      const comebacks = Math.max(0, (terms?.hostMaxLeaves ?? 0) - (room.hostLeaves ?? 0));
      const misses = Math.max(0, (terms?.hostMaxMissed ?? 0) - (room.hostMissed ?? 0));
      notice = {
        icon: 'shield',
        tone: comebacks === 0 || misses === 0 ? 'warn' : 'info',
        text: `${comebacks} comeback${comebacks === 1 ? '' : 's'} · ${misses} missed turn${misses === 1 ? '' : 's'} left · earned ${Math.floor(room.hostEarned ?? 0)}`,
      };
    } else if (myPlayer) {
      const minutes = rateNow > 0 ? Math.floor(myCoins / rateNow) : 0;
      notice = minutes < 2
        ? {
            icon: 'warning-amber',
            tone: 'warn',
            text: minutes === 0
              ? `Not enough coins for the next minute (${rateNow}). You'll lose your seat.`
              : `Low coins: enough for 1 more minute at ${rateNow} a minute.`,
          }
        : {
            icon: 'timer',
            tone: 'info',
            text: `${rateNow} coins a minute · paid ${Math.floor(room.paidBy?.[myUid] ?? 0)} so far`,
          };
    }
  }
  const canRoll = isMyTurn && !room.diceRolled && room.phase === 'playing' && !asSpectator && !rolling;

  const turnPlayer = byColor[room.currentTurn];
  const turnName = turnPlayer?.nickname ?? GEMS[room.currentTurn].name;

  // "0s left" sat on screen while the server's grace ran out, reading as a
  // frozen clock. Say what is happening instead.
  const clockOn = secondsLeft !== null && room.phase === 'playing';
  const clockUrgent = clockOn && secondsLeft <= 3;
  const clockText = !clockOn ? ' ' : secondsLeft === 0 ? 'Time is up — passing' : `${secondsLeft}s left`;

  let eyebrow: string;
  let instruction: string;
  if (isWaiting) {
    // `currentTurn` is only a default colour until the game starts; reading it
    // here told the host "Your turn -- roll the dice" on a table still filling.
    eyebrow = 'Not started';
    instruction = !enoughToStart
      ? 'Waiting for players'
      : isHost ? 'Start when everyone is in' : `Waiting for ${hostName}`;
  } else if (isOver) {
    // `currentTurn` keeps its last value, so this said "Your turn" after the end.
    eyebrow = 'Game over';
    instruction = room.settlement?.reason === 'empty_table' ? 'Nobody came back' : 'Thanks for playing';
  } else if (paused) {
    eyebrow = 'Paused';
    instruction = canTakeSeat ? 'Take a free seat to play' : 'Waiting for a player';
  } else if (asSpectator) {
    eyebrow = 'Watching';
    instruction = `${turnName} is playing`;
  } else if (isMyTurn) {
    eyebrow = 'Your turn';
    instruction = !room.diceRolled
      ? 'Roll the dice'
      : legalMoveIds.length > 0
        ? 'Tap a gem to move'
        : 'No legal moves — passing';
  } else {
    eyebrow = `${turnName}'s turn`;
    instruction = 'Waiting for their move';
  }

  // Stack tokens that share a square so none are hidden.
  const occupancy = new Map<string, number>();
  const tokenViews = room.tokens.map((t) => {
      const cell = cellForPosition(t.color as PlayerColor, t.position, t.index);
      const key = `${cell.x},${cell.y}`;
      const stack = occupancy.get(key) ?? 0;
      occupancy.set(key, stack + 1);
      const movable = legalSet.has(t.id) && !busyToken;
      return (
        <LudoPawn
          key={t.id}
          color={t.color as PlayerColor}
          index={t.index}
          position={t.position}
          cellSize={cellSize}
          stackOffset={stack * 0.16}
          movable={movable}
          reduceMotion={reduceMotion}
          onPress={() => handleTokenPress(t.id)}
          label={`${GEMS[t.color as PlayerColor].name} pawn ${t.index + 1}${movable ? ', tap to move' : ''}`}
        />
      );
    });

  const unread = Math.max(0, events.filter((e) => e.type === 'chat').length - seenCount);
  const feed = events.filter((e) => ['chat', 'capture', 'gift', 'win'].includes(e.type));

  const renderSeat = (color: PlayerColor, align: 'left' | 'right') => {
    const player = byColor[color] ?? null;
    const tokensHome = room.tokens.filter((t) => t.color === color && t.position === FINISHED_POSITION).length;
    const rankIdx = player ? room.winnersOrder.indexOf(player.uid) : -1;
    return (
      <PlayerSeat
        key={color}
        color={color}
        player={player}
        align={align}
        isActive={room.currentTurn === color && room.phase === 'playing'}
        isYou={!!player && player.uid === myUid}
        turnProgress={room.currentTurn === color && room.phase === 'playing' ? turnProgress : null}
        secondsLeft={room.currentTurn === color ? secondsLeft : null}
        tokensHome={tokensHome}
        rank={rankIdx >= 0 ? rankIdx + 1 : null}
        seatOffer={seatOffer}
        onTakeSeat={canTakeSeat && !coinBusy ? () => handleTakeSeat(color) : undefined}
        taking={takingSeat === color}
        betLabel={room.gameMode === 'per_token' && player && player.uid !== myUid ? `Back ${BET_AMOUNT}` : null}
        onBet={room.gameMode === 'per_token' && player && player.uid !== myUid && !coinBusy ? () => handleBet(color) : undefined}
      />
    );
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={handleLeave}
            accessibilityRole="button"
            accessibilityLabel="Leave the table"
            style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
          >
            <MaterialIcons name="arrow-back" size={20} color={ludo.ink} />
          </Pressable>
          <View style={styles.headerMid}>
            <Text style={ludoType.eyebrow}>Ludo table</Text>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {perMinute
                ? (room.phase === 'playing' && paying > 0 ? `${rateNow} coins a minute` : 'Per-minute table')
                : room.gameMode === 'per_token' ? 'Roll & Back' : 'Ticket Table'}
            </Text>
          </View>
          <View style={styles.watchers}>
            <MaterialIcons name="visibility" size={13} color={ludo.inkFaint} />
            <Text style={[styles.watchersText, numeric]}>{watcherCount}</Text>
          </View>
        </View>

        <ConnectionBanner state={connection} tone="light" />

        {stripHeight > 0 && (
          <View
            style={[styles.strip, notice?.tone === 'warn' && styles.stripWarn]}
            accessibilityLiveRegion="polite"
          >
            {notice ? (
              <>
                <MaterialIcons
                  name={notice.icon as any}
                  size={16}
                  color={notice.tone === 'warn' ? '#8A4B00' : ludo.inkSoft}
                />
                <Text
                  style={[styles.stripText, numeric, notice.tone === 'warn' && styles.stripTextWarn]}
                  numberOfLines={2}
                >
                  {notice.text}
                </Text>
              </>
            ) : null}
          </View>
        )}

        {/* Table */}
        <View style={styles.stage}>
          <View style={[styles.seatRow, { width: boardSize + 8 }]}>
            {SEAT_LAYOUT[0].map(({ color, align }) => renderSeat(color, align))}
          </View>

          <View style={[styles.boardFrame, { width: boardSize + 12, height: boardSize + 12 }]}>
            <View style={{ width: boardSize, height: boardSize }}>
              <LudoBoardSurface size={boardSize} />
              <View style={[StyleSheet.absoluteFill, { width: boardSize, height: boardSize }]} pointerEvents="box-none">
                {tokenViews}
              </View>
            </View>
            <Animated.View
              pointerEvents="none"
              style={[styles.captureFlash, { opacity: captureFlash }]}
            />
          </View>

          <View style={[styles.seatRow, { width: boardSize + 8 }]}>
            {SEAT_LAYOUT[1].map(({ color, align }) => renderSeat(color, align))}
          </View>
        </View>

        {/* Action dock */}
        <View style={styles.dock}>
          <View style={styles.dockCopy}>
            <Text
              style={[
                ludoType.eyebrow,
                isMyTurn && !asSpectator && !isWaiting && { color: GEMS[room.currentTurn].ink },
              ]}
            >
              {eyebrow}
            </Text>
            {/* One line, always, and the clock line always reserved. The board
                is centred in whatever the dock leaves, so an instruction that
                wrapped on a larger font, or a clock line coming and going,
                shifted the whole board a few pixels every turn. */}
            <Text
              style={styles.dockInstruction}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {instruction}
            </Text>
            <Text style={[styles.dockClock, numeric, clockUrgent && { color: ludo.danger }]}>
              {clockText}
            </Text>
          </View>
          <LudoDie
            value={rolled ?? room.diceValue}
            rolling={rolling}
            enabled={canRoll}
            turnColor={room.currentTurn as PlayerColor}
            cost={room.gameMode === 'per_token' && isMyTurn ? ROLL_COST : null}
            onPress={handleRoll}
            reduceMotion={reduceMotion}
          />
        </View>

        {/* Utility rail */}
        <View style={styles.rail}>
          <RailButton
            icon="chat-bubble-outline"
            label="Chat"
            badge={unread}
            onPress={() => setSheet('chat')}
          />
          <RailButton
            icon="gift"
            community
            label="Gift"
            onPress={() => {
              setGiftTarget(room.players.find((p) => p.uid !== myUid)?.uid ?? null);
              setSheet('gift');
            }}
          />
          <RailButton
            icon={micMuted ? 'mic-off' : 'mic'}
            // Names what it controls, not what tapping does. Beside it sat
            // the speaker toggle reading 'Muted', so the rail offered
            // 'Mute' and 'Muted' side by side -- one an instruction, one a
            // state, for two different things. The icon and the highlight
            // carry on/off on both now.
            label="Mic"
            active={micMuted}
            onPress={toggleMic}
            ionicon
          />
          <RailButton
            icon={speakerOn ? 'volume-high' : 'volume-mute'}
            label="Speaker"
            active={!speakerOn}
            onPress={toggleSpeaker}
            ionicon
          />
        </View>
      </SafeAreaView>

      {/* Lobby */}
      {isWaiting && (
        <View style={styles.overlay} pointerEvents="box-none">
          <View style={styles.lobbyCard}>
            <Text style={ludoType.eyebrow}>Waiting to start</Text>
            <Text style={styles.lobbyTitle}>
              {/* "1 of 4" read as "four are required" and the card gave no
                  other clue, so a table that only needed one more person
                  looked like one that was stuck. Two is the real threshold
                  handleStart enforces, so the card says that instead. */}
              {room.players.length === 1
                ? 'One more player to start'
                : `${room.players.length} of 4 seated`}
            </Text>
            <Text style={styles.lobbyBody}>
              {!enoughToStart
                // Somebody already seated has no seat left to tap.
                ? (myPlayer
                  ? 'Ludo needs at least two. Waiting for somebody to take a seat.'
                  : 'Ludo needs at least two. Tap an open seat to join, or wait for somebody else.')
                : isHost
                  ? 'Start when everyone is in. Empty seats sit out the game.'
                  : `${hostName} starts the game.`}
            </Text>
            {perMinute ? (
              <Text style={[styles.lobbyNote, numeric]}>
                {isHost
                  ? `Players pay ${ludoRate(terms, Math.max(1, paying))} coins a minute once you start. You keep ${terms?.hostSharePercent ?? 0}%.`
                  : `Seats are free. Players pay ${ludoRate(terms, Math.max(1, myPlayer ? paying : paying + 1))} coins a minute once the game starts.`}
              </Text>
            ) : null}
            {isHost ? (
              <Pressable
                onPress={handleStart}
                disabled={coinBusy || !enoughToStart}
                accessibilityRole="button"
                accessibilityLabel="Start the game"
                accessibilityState={{ disabled: coinBusy || !enoughToStart }}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  pressed && styles.pressed,
                  (coinBusy || !enoughToStart) && { opacity: 0.5 },
                ]}
              >
                <MaterialIcons name="play-arrow" size={18} color="#FFFFFF" />
                <Text style={styles.primaryBtnText}>Start game</Text>
              </Pressable>
            ) : enoughToStart ? (
              // Only spin while something really is being waited on. Below the
              // threshold nothing is loading, and a spinner said otherwise.
              <ActivityIndicator color={ludo.ink} />
            ) : null}
          </View>
        </View>
      )}

      {/* Results */}
      {isOver && (
        <View style={styles.overlay}>
          <View style={styles.lobbyCard}>
            <Text style={ludoType.eyebrow}>Final table</Text>
            <Text style={styles.lobbyTitle}>
              {room.winnersOrder[0] === myUid
                ? 'You won'
                : `${room.players.find((p) => p.uid === room.winnersOrder[0])?.nickname ?? 'Nobody'} won`}
            </Text>
            <View style={styles.results}>
              {room.winnersOrder.map((uid, i) => {
                const p = room.players.find((pl) => pl.uid === uid);
                return (
                  <View key={uid} style={styles.resultRow}>
                    <Text style={[styles.resultRank, numeric]}>{i + 1}</Text>
                    <View style={[styles.resultDot, { backgroundColor: GEMS[(p?.color ?? 'red') as PlayerColor].core }]} />
                    <Text style={styles.resultName} numberOfLines={1}>
                      {uid === myUid ? 'You' : p?.nickname ?? 'Player'}
                    </Text>
                  </View>
                );
              })}
            </View>
            {perMinute && room.settlement ? (
              <View style={styles.payouts}>
                {room.settlement.prize ? (
                  <Text style={[styles.payoutLine, numeric]}>
                    {room.settlement.prize.uid === myUid
                      ? `You won the ${room.settlement.prize.amount}-coin bonus.`
                      : `${room.players.find((p) => p.uid === room.settlement?.prize?.uid)?.nickname ?? 'The winner'} won the ${room.settlement.prize.amount}-coin bonus.`}
                  </Text>
                ) : null}
                {Object.keys(room.settlement.depositToPlayers ?? {}).length > 0 ? (
                  <Text style={[styles.payoutLine, numeric]}>
                    {hostName} broke a limit, so the {room.settlement.deposit}-coin deposit was shared
                    {room.settlement.depositToPlayers?.[myUid]
                      ? `: you got ${room.settlement.depositToPlayers[myUid]}.`
                      : ` among the players.`}
                  </Text>
                ) : null}
                {myPlayer && !isHost ? (
                  <Text style={[styles.payoutLine, numeric]}>
                    You paid {Math.floor(room.paidBy?.[myUid] ?? 0)} coins for this game.
                  </Text>
                ) : null}
                {isHost ? (
                  <Text style={[styles.payoutLine, numeric]}>
                    You earned {Math.floor(room.hostEarned ?? 0)} coins from this table.
                  </Text>
                ) : null}
              </View>
            ) : null}
            <Pressable
              onPress={handleLeave}
              accessibilityRole="button"
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
            >
              <Text style={styles.primaryBtnText}>Leave table</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Chat sheet */}
      <Modal visible={sheet === 'chat'} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <KeyboardAvoidingView
          style={styles.sheetRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={styles.sheetScrim} onPress={() => setSheet(null)} accessibilityLabel="Close chat" />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
            <View style={styles.sheetGrip} />
            <Text style={styles.sheetTitle}>Table chat</Text>
            <ScrollView
              ref={chatRef}
              style={styles.feed}
              onContentSizeChange={() => chatRef.current?.scrollToEnd({ animated: true })}
            >
              {feed.length === 0 ? (
                <Text style={styles.feedEmpty}>No messages yet. Say hello.</Text>
              ) : (
                feed.map((e, i) => (
                  <View key={e.id ?? i} style={styles.feedRow}>
                    {e.type === 'chat' ? (
                      <>
                        <Text style={[styles.feedName, e.senderUid === myUid && { color: ludo.inkSoft }]}>
                          {e.senderUid === myUid ? 'You' : e.senderName}
                        </Text>
                        <Text style={styles.feedText}>{e.text}</Text>
                      </>
                    ) : (
                      <Text style={styles.feedSystem}>
                        {e.type === 'capture' && `${e.senderName} sent a gem home`}
                        {e.type === 'gift' && `${e.senderName} sent ${e.giftName}`}
                        {e.type === 'win' && `${e.senderName} finished`}
                      </Text>
                    )}
                  </View>
                ))
              )}
            </ScrollView>
            <View style={styles.composer}>
              <TextInput
                style={styles.input}
                value={chatText}
                onChangeText={setChatText}
                placeholder="Message the table"
                placeholderTextColor={ludo.inkFaint}
                onSubmitEditing={handleSendChat}
                returnKeyType="send"
                accessibilityLabel="Message the table"
              />
              <Pressable
                onPress={handleSendChat}
                accessibilityRole="button"
                accessibilityLabel="Send message"
                style={({ pressed }) => [styles.sendBtn, pressed && styles.pressed]}
              >
                <MaterialIcons name="send" size={17} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Gift sheet */}
      <Modal visible={sheet === 'gift'} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <View style={styles.sheetRoot}>
          <Pressable style={styles.sheetScrim} onPress={() => setSheet(null)} accessibilityLabel="Close gifts" />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
            <View style={styles.sheetGrip} />
            <Text style={styles.sheetTitle}>Send a gift</Text>

            {room.players.filter((p) => p.uid !== myUid).length === 0 ? (
              <Text style={styles.feedEmpty}>Nobody else is seated yet.</Text>
            ) : (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.targets}>
                  {room.players.filter((p) => p.uid !== myUid).map((p) => (
                    <Pressable
                      key={p.uid}
                      onPress={() => setGiftTarget(p.uid)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: giftTarget === p.uid }}
                      accessibilityLabel={`Send to ${p.nickname}`}
                      style={[styles.target, giftTarget === p.uid && { borderColor: GEMS[p.color as PlayerColor].core }]}
                    >
                      <GengalAvatar data={p.avatarData} size={34} />
                      <Text style={styles.targetName} numberOfLines={1}>{p.nickname}</Text>
                    </Pressable>
                  ))}
                </ScrollView>

                <View style={styles.gifts}>
                  {LUDO_GIFTS.map((g) => (
                    <Pressable
                      key={g.id}
                      onPress={() => handleGift(g)}
                      disabled={coinBusy}
                      accessibilityRole="button"
                      accessibilityLabel={`${g.name}, ${g.cost} coins`}
                      accessibilityState={{ disabled: coinBusy }}
                      style={({ pressed }) => [styles.gift, pressed && styles.pressed, coinBusy && { opacity: 0.5 }]}
                    >
                      <Text style={styles.giftEmoji}>{g.emoji}</Text>
                      <Text style={styles.giftName}>{g.name}</Text>
                      <Text style={[styles.giftCost, numeric]}>{g.cost}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function RailButton({
  icon, label, onPress, badge, active, ionicon, community,
}: {
  icon: string; label: string; onPress: () => void;
  badge?: number; active?: boolean; ionicon?: boolean; community?: boolean;
}) {
  const Icon: any = ionicon ? Ionicons : community ? MaterialCommunityIcons : MaterialIcons;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.railBtn, active && styles.railBtnActive, pressed && styles.pressed]}
    >
      <Icon name={icon} size={19} color={active ? ludo.danger : ludo.ink} />
      <Text style={styles.railLabel}>{label}</Text>
      {!!badge && badge > 0 && (
        <View style={styles.badge}>
          <Text style={[styles.badgeText, numeric]}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

const FILL = { position: 'absolute' as const, left: 0, right: 0, top: 0, bottom: 0 };

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ludo.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 28 },
  loadingText: { color: ludo.inkSoft, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  goneTitle: { color: ludo.ink, fontSize: 20, fontWeight: '800' },
  goneBtn: {
    marginTop: 8, paddingHorizontal: 22, paddingVertical: 12,
    borderRadius: 14, backgroundColor: ludo.ink,
  },
  goneBtnText: { color: ludo.surface, fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.7 },

  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 10,
  },
  iconBtn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: ludo.card,
    borderWidth: 1, borderColor: ludo.hairline,
  },
  headerMid: { flex: 1 },
  headerTitle: { ...ludoType.display, fontSize: 17, marginTop: 1 },
  watchers: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12,
    borderWidth: 1, borderColor: ludo.hairline,
    backgroundColor: ludo.card,
  },
  watchersText: { color: ludo.inkSoft, fontSize: 11, fontWeight: '800' },

  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  seatRow: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  boardFrame: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: ludoRadius.board,
    borderWidth: 7,
    borderColor: ludo.frame,
    backgroundColor: ludo.board,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 12,
  },
  captureFlash: {
    ...FILL,
    backgroundColor: 'rgba(255, 235, 130, 0.55)',
  },

  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: ludoRadius.dock,
    backgroundColor: ludo.card,
    borderWidth: 1,
    borderColor: ludo.hairline,
  },
  dockCopy: { flex: 1, gap: 3 },
  dockInstruction: { ...ludoType.display, fontSize: 19 },
  dockClock: { color: ludo.inkFaint, fontSize: 11, fontWeight: '700' },

  rail: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
  },
  railBtn: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: ludo.card,
    borderWidth: 1,
    borderColor: ludo.hairline,
  },
  railBtnActive: { borderColor: 'rgba(227,43,34,0.55)', backgroundColor: 'rgba(227,43,34,0.10)' },
  railLabel: { color: ludo.inkSoft, fontSize: 9, fontWeight: '800' },
  badge: {
    position: 'absolute', top: 4, right: 10,
    minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: ludo.danger,
  },
  badgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },

  overlay: {
    ...FILL,
    backgroundColor: 'rgba(28, 28, 28, 0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  lobbyCard: {
    width: '100%',
    maxWidth: 330,
    borderRadius: ludoRadius.sheet,
    padding: 24,
    gap: 10,
    alignItems: 'center',
    backgroundColor: ludo.card,
    borderWidth: 1,
    borderColor: ludo.hairline,
  },
  lobbyTitle: { ...ludoType.display, fontSize: 24, textAlign: 'center' },
  lobbyBody: { ...ludoType.body, textAlign: 'center', lineHeight: 19 },
  lobbyNote: { color: ludo.inkSoft, fontSize: 12, fontWeight: '700', textAlign: 'center', lineHeight: 17 },
  payouts: {
    alignSelf: 'stretch', gap: 6, padding: 12, borderRadius: 14,
    backgroundColor: ludo.cardSunk, borderWidth: 1, borderColor: ludo.hairline,
  },
  payoutLine: { color: ludo.ink, fontSize: 13, fontWeight: '700', lineHeight: 18 },

  // One line of per-minute news under the header: paused, host away, coins.
  strip: {
    height: 36,
    marginHorizontal: 14,
    marginBottom: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: ludo.cardSunk,
    borderWidth: 1,
    borderColor: ludo.hairline,
  },
  stripWarn: { backgroundColor: '#FFF4DC', borderColor: '#F1D08A' },
  stripText: { flex: 1, color: ludo.inkSoft, fontSize: 12, fontWeight: '700', lineHeight: 15 },
  stripTextWarn: { color: '#6E3B00' },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 8, height: 48, alignSelf: 'stretch',
    borderRadius: 24, backgroundColor: ludo.ink,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  results: { alignSelf: 'stretch', gap: 8, marginTop: 4 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  resultRank: { color: ludo.inkFaint, fontSize: 13, fontWeight: '900', width: 18 },
  resultDot: { width: 10, height: 10, borderRadius: 5 },
  resultName: { color: ludo.ink, fontSize: 14, fontWeight: '700', flex: 1 },

  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetScrim: { ...FILL, backgroundColor: 'rgba(28,28,28,0.5)' },
  sheet: {
    backgroundColor: ludo.card,
    borderTopLeftRadius: ludoRadius.sheet,
    borderTopRightRadius: ludoRadius.sheet,
    borderTopWidth: 1,
    borderColor: ludo.hairline,
    paddingHorizontal: 18,
    paddingTop: 10,
    gap: 12,
    maxHeight: '72%',
  },
  sheetGrip: {
    width: 38, height: 4, borderRadius: 2,
    backgroundColor: ludo.gridSoft, alignSelf: 'center',
  },
  sheetTitle: { ...ludoType.display, fontSize: 18 },
  feed: { maxHeight: 260 },
  feedEmpty: { ...ludoType.body, paddingVertical: 22, textAlign: 'center' },
  feedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 7 },
  feedName: { color: GEMS.blue.core, fontSize: 13, fontWeight: '900' },
  feedText: { color: ludo.ink, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  feedSystem: { color: ludo.inkFaint, fontSize: 12, fontWeight: '700', fontStyle: 'italic' },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: {
    flex: 1, height: 44, borderRadius: 22, paddingHorizontal: 16,
    backgroundColor: ludo.cardSunk,
    borderWidth: 1, borderColor: ludo.hairline,
    color: ludo.ink, fontSize: 14,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: ludo.ink,
  },
  targets: { gap: 10, paddingVertical: 2 },
  target: {
    width: 74, alignItems: 'center', gap: 5, padding: 8,
    borderRadius: 14, borderWidth: 1.5, borderColor: ludo.hairline,
    backgroundColor: ludo.cardSunk,
  },
  targetName: { color: ludo.inkSoft, fontSize: 10, fontWeight: '800' },
  gifts: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gift: {
    width: 74, alignItems: 'center', gap: 3, paddingVertical: 12,
    borderRadius: 14, borderWidth: 1, borderColor: ludo.hairline,
    backgroundColor: ludo.cardSunk,
  },
  giftEmoji: { fontSize: 26 },
  giftName: { color: ludo.ink, fontSize: 11, fontWeight: '800' },
  giftCost: { color: ludo.inkSoft, fontSize: 10, fontWeight: '800' },
});
