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
import { Ionicons, MaterialIcons } from '@expo/vector-icons';

import GengalAvatar from '../components/GengalAvatar';
import { LudoPawn } from '../components/ludo/LudoPawn';
import { LudoBoardSurface } from '../components/ludo/LudoBoardSurface';
import { LudoDie } from '../components/ludo/LudoDie';
import { PlayerSeat } from '../components/ludo/PlayerSeat';
import { cellForPosition, PlayerColor } from './LudoConstants';
import { GEMS, ludo, ludoRadius, ludoType, numeric } from '../theme/ludoTheme';

import { useRoomVoice } from '../hooks/useRoomVoice';
import { auth } from '../config/firebase';
import { useUser } from '../context/UserContext';
import { useRoomPresence } from '../hooks/useRoomPresence';
import ConnectionBanner from '../components/rooms/ConnectionBanner';
import {
  LudoEvent, LudoPlayer, LudoRoom, TokenColor, LUDO_GIFTS,
  FINISHED_POSITION,
  subscribeToLudoRoom, subscribeToLudoEvents,
  joinLudoRoom, leaveLudoRoom,
  startGame, rollDice, moveToken, skipTurn, closeLudoRoom,
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
const SEAT_LAYOUT: { color: PlayerColor; align: 'left' | 'right' }[][] = [
  [{ color: 'red', align: 'left' }, { color: 'blue', align: 'right' }],
  [{ color: 'yellow', align: 'left' }, { color: 'green', align: 'right' }],
];

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

  const [room, setRoom] = useState<LudoRoom | null>(null);
  const [events, setEvents] = useState<LudoEvent[]>([]);
  const [chatText, setChatText] = useState('');
  const [rolling, setRolling] = useState(false);
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const [asSpectator, setAsSpectator] = useState(false);
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

  // Players talk, spectators listen. The token is minted by the backend — the
  // previous code passed the literal string `ludo_<roomId>` where the Agora
  // token belongs, so the channel was never actually joined.
  const { toggleMic, micMuted, toggleSpeaker, speakerOn } =
    useRoomVoice(roomId, asSpectator ? 'audience' : 'broadcaster', !!roomId && !!myUid);

  // ── Board sizing ───────────────────────────────────────────────────────────
  // Budget for header, both seat rows, the action dock and the utility rail, so
  // the board never pushes the controls off-screen on a short device.
  const CHROME = 52 + 64 * 2 + 118 + 56 + 26;
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
    if (!roomId) return;
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
      spectatorRef.current = spec;
      setAsSpectator(spec);
    });
    return () => { leaveLudoRoom(roomId, myUid, myName, spectatorRef.current); };
  }, [roomId, myUid]);

  const myPlayer = room?.players.find((p) => p.uid === myUid) ?? null;
  const isHost = room?.hostUid === myUid;

  // Heartbeat presence for everyone at the table. Seats are deliberately not
  // driven by this — a player who drops off the network for a moment keeps the
  // seat they paid for. What it fixes is the watcher count, which was a bare
  // counter that only ever grew as spectators' clients died without leaving.
  const { liveCount, connection } = useRoomPresence({
    collectionName: 'ludo_rooms',
    roomId,
    uid: myUid,
    nickname: myName,
    avatarData: myAvatarData,
    isHost,
    countField: 'presentCount',
    enabled: !!room,
  });

  const watcherCount = Math.max(0, liveCount - (room?.players.length ?? 0));
  const isMyTurn = !!myPlayer && myPlayer.color === room?.currentTurn;

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
    if (!room?.turnStartedAt || room.phase !== 'playing') {
      setSecondsLeft(null);
      return;
    }
    const endsAt = room.turnStartedAt.toMillis() + room.turnTimeoutSecs * 1000;
    const tick = () => {
      const rem = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setSecondsLeft(rem);
      if (rem === 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        if (isMyTurn || isHost) skipTurn(roomId, room).catch(() => {});
      }
    };
    tick();
    timerRef.current = setInterval(tick, 250);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [room?.currentTurn, room?.turnStartedAt, room?.phase, isMyTurn, isHost, roomId]);

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
      if (room.gameMode === 'per_token') {
        const { deductUserCoins, deductUserCoinsWithCommission } = await import('../services/coinService');
        if (room.hostUid !== myUid) {
          await deductUserCoinsWithCommission(myUid, ROLL_COST, room.hostUid, 2);
        } else {
          await deductUserCoins(myUid, ROLL_COST);
        }
      }
      // Let the tumble read before the value lands.
      await new Promise((r) => setTimeout(r, reduceMotion ? 0 : 520));
      await rollDice(roomId, myUid, myName, myAvatarData, room);
    } catch (e: any) {
      Alert.alert('Roll failed', e?.message || 'That roll did not go through. Try again.');
    } finally {
      setRolling(false);
    }
  }, [room, isMyTurn, rolling, profile, roomId, myUid, myName, myAvatarData, reduceMotion]);

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

  const handleTakeSeat = useCallback((color: TokenColor) => runCoin(async () => {
    if (!room) return;
    const price = room.ticketPrice ?? DEFAULT_SEAT_PRICE;
    if ((profile?.coins ?? 0) < price) {
      Alert.alert('Not enough coins', `A seat costs ${price} coins. Top up in the store.`);
      return;
    }
    try {
      await buyLudoTicket(roomId, myUid, myName, myAvatarData, price, room.hostUid, color);
    } catch (e: any) {
      Alert.alert('Could not take that seat', e?.message || 'Someone may have taken it first.');
    }
  }), [room, profile, roomId, myUid, myName, myAvatarData, runCoin]);

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
    await startGame(roomId);
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

  const handleLeave = useCallback(async () => {
    await leaveLudoRoom(roomId, myUid, myName, spectatorRef.current);
    if (isHost) await closeLudoRoom(roomId).catch(() => {});
    goBack?.();
  }, [roomId, myUid, myName, isHost, goBack]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (!room) {
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
  const isOver = room.phase === 'finished';
  const canRoll = isMyTurn && !room.diceRolled && room.phase === 'playing' && !asSpectator && !rolling;

  const turnPlayer = byColor[room.currentTurn];
  const turnName = turnPlayer?.nickname ?? GEMS[room.currentTurn].name;

  let eyebrow: string;
  let instruction: string;
  if (asSpectator) {
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
        seatPrice={isWaiting && !myPlayer ? (room.ticketPrice ?? DEFAULT_SEAT_PRICE) : null}
        onTakeSeat={isWaiting && !myPlayer && !coinBusy ? () => handleTakeSeat(color) : undefined}
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
              {room.gameMode === 'per_token' ? 'Roll & Back' : 'Ticket Table'}
            </Text>
          </View>
          <View style={styles.watchers}>
            <MaterialIcons name="visibility" size={13} color={ludo.inkFaint} />
            <Text style={[styles.watchersText, numeric]}>{watcherCount}</Text>
          </View>
        </View>

        <ConnectionBanner state={connection} tone="light" />

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
                isMyTurn && !asSpectator && { color: GEMS[room.currentTurn].core },
              ]}
            >
              {eyebrow}
            </Text>
            <Text style={styles.dockInstruction}>{instruction}</Text>
            {secondsLeft !== null && room.phase === 'playing' && (
              <Text style={[styles.dockClock, numeric, secondsLeft <= 3 && { color: ludo.danger }]}>
                {secondsLeft}s left
              </Text>
            )}
          </View>
          <LudoDie
            value={room.diceValue}
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
            icon="card-giftcard"
            label="Gift"
            onPress={() => {
              setGiftTarget(room.players.find((p) => p.uid !== myUid)?.uid ?? null);
              setSheet('gift');
            }}
          />
          <RailButton
            icon={micMuted ? 'mic-off' : 'mic'}
            label={micMuted ? 'Unmute' : 'Mute'}
            active={micMuted}
            onPress={toggleMic}
            ionicon
          />
          <RailButton
            icon={speakerOn ? 'volume-high' : 'volume-mute'}
            label={speakerOn ? 'Speaker' : 'Muted'}
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
              {room.players.length} of 4 seated
            </Text>
            <Text style={styles.lobbyBody}>
              {isHost
                ? 'Start when everyone is in. Empty seats sit out the game.'
                : `${byColor[room.currentTurn]?.nickname ?? 'The host'} starts the game.`}
            </Text>
            {isHost ? (
              <Pressable
                onPress={handleStart}
                disabled={coinBusy}
                accessibilityRole="button"
                accessibilityLabel="Start the game"
                accessibilityState={{ disabled: coinBusy }}
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed, coinBusy && { opacity: 0.5 }]}
              >
                <MaterialIcons name="play-arrow" size={18} color="#FFFFFF" />
                <Text style={styles.primaryBtnText}>Start game</Text>
              </Pressable>
            ) : (
              <ActivityIndicator color={ludo.ink} />
            )}
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
  icon, label, onPress, badge, active, ionicon,
}: {
  icon: string; label: string; onPress: () => void;
  badge?: number; active?: boolean; ionicon?: boolean;
}) {
  const Icon: any = ionicon ? Ionicons : MaterialIcons;
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: ludo.inkSoft, fontSize: 13, fontWeight: '700' },
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
