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
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Polygon, Circle } from 'react-native-svg';
import { PATH, PLAYERS, PLAYER_NAMES, START_INDEX, STAR_CELLS, HOME_COLUMN, BASE_ORIGIN, BASE_PADS, HOME_REST, HOME_PROGRESS, cellForProgress, PlayerColor, Cell } from './LudoConstants';






import { MaterialIcons } from '@expo/vector-icons';
import GengalAvatar from '../components/GengalAvatar';
import ScreenShell from '../components/ScreenShell';
import { skeuo } from '../theme/skeuomorphic';
import { auth } from '../config/firebase';
import { useUser } from '../context/UserContext';
import {
  LudoRoom, LudoEvent, LudoPlayer, Token, TokenColor,
  TOKEN_COLORS, COLOR_ENTRY, HOME_COLUMN_START, FINISHED_POSITION, BASE_POSITION,
  SAFE_CELLS, LUDO_GIFTS,
  subscribeToLudoRoom, subscribeToLudoEvents,
  joinLudoRoom, leaveLudoRoom,
  startGame, rollDice, moveToken, skipTurn, closeLudoRoom,
  getLegalMoves, nextTurn,
  sendLudoChat, sendLudoGift,
} from '../services/ludoService';

const SCREEN_W = Dimensions.get('window').width;
const ARENA_SIZE = Math.min(SCREEN_W, 400); // 400px max width
const BOARD_SIZE = Math.floor(ARENA_SIZE * 0.70); // 70% to ensure overlap with 100px panels
const BOARD_BORDER = 10;
const INNER_SIZE = BOARD_SIZE - BOARD_BORDER * 2;
const CELL_SIZE = Math.floor(INNER_SIZE / 15);

interface Props {
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
  route?: { params?: { roomId?: string } };
}


// ── Styling Constants ─────────────────────────────────────────────────────────

const COLOR_BG: Record<TokenColor, string> = {
  red: '#dc2626',
  green: '#16a34a',
  yellow: '#eab308',
  blue: '#2563eb',
};

const COLOR_SOFT: Record<TokenColor, string> = {
  red: 'rgba(239, 68, 68, 0.25)',
  green: 'rgba(34, 197, 94, 0.25)',
  yellow: 'rgba(234, 179, 8, 0.25)',
  blue: 'rgba(59, 130, 246, 0.25)',
};

const COLOR_BORDER: Record<TokenColor, string> = {
  red: 'rgba(239, 68, 68, 0.5)',
  green: 'rgba(34, 197, 94, 0.5)',
  yellow: 'rgba(234, 179, 8, 0.5)',
  blue: 'rgba(59, 130, 246, 0.5)',
};

const COLOR_FILL: Record<TokenColor, string> = {
  red: '#dc2626',
  green: '#16a34a',
  yellow: '#eab308',
  blue: '#2563eb',
};



// ── Components ───────────────────────────────────────────────────────────────

function TokenView({ color, progress, index, movable, onPress, stackOffset }: { color: TokenColor, progress: number, index: number, movable: boolean, onPress: () => void, stackOffset: number }) {
  const cell = cellForProgress(color, progress, index);
  const pulse = useRef(new Animated.Value(1)).current;
  const small = progress === -1 || progress === HOME_PROGRESS;

  useEffect(() => {
    if (movable) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.15, duration: 550, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 550, useNativeDriver: true })
        ])
      ).start();
    } else {
      pulse.setValue(1);
    }
  }, [movable]);

  const size = small ? 5 : 6.66;
  const left = (cell.x * (100 / 15)) + (100/15)/2 - size/2 + stackOffset;
  const top = (cell.y * (100 / 15)) + (100/15)/2 - size/2 + stackOffset;

  return (
    <Animated.View style={[
      StyleSheet.absoluteFill,
      {
        left: `${left}%` as any,
        top: `${top}%` as any,
        width: `${size}%` as any,
        height: `${size}%` as any,
        zIndex: 50 + stackOffset,
        transform: [{ scale: pulse }]
      }
    ]}>
      <TouchableOpacity onPress={onPress} disabled={!movable} style={{ width: '100%', height: '100%' }} activeOpacity={0.7}>
        <View style={{
          width: '100%', height: '100%', borderRadius: 999,
          backgroundColor: COLOR_BG[color],
          borderWidth: 2, borderColor: 'rgba(0,0,0,0.3)',
          shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.45, shadowRadius: 10, elevation: 8
        }}>
          <View style={{ position: 'absolute', top: '10%', left: '15%', width: '40%', height: '40%', backgroundColor: 'rgba(255,255,255,0.4)', borderRadius: 999 }} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

function Board({ room, myPlayer, onMove }: { room: LudoRoom, myPlayer: LudoPlayer | null, onMove: (id: string) => void }) {
  const isMyTurn = myPlayer?.color === room.currentTurn;
  const legalMoveIds = isMyTurn && room.diceRolled && room.diceValue ? getLegalMoves(room.tokens, room.currentTurn, room.diceValue) : [];
  const legalIdsSet = new Set(legalMoveIds);

  const occupancy = new Map<string, number>();

  return (
    <View style={boardStyles.container}>
      {/* Base Quadrants */}
      {PLAYERS.map(p => {
        const origin = BASE_ORIGIN[p];
        const CELL = 100/15;
        return (
          <View key={`base-${p}`} style={[
            boardStyles.baseQuadrant,
            { backgroundColor: COLOR_SOFT[p], borderColor: COLOR_BORDER[p] },
            { left: `${origin.x * CELL + 0.8}%` as any, top: `${origin.y * CELL + 0.8}%` as any, width: `${6 * CELL - 1.6}%` as any, height: `${6 * CELL - 1.6}%` as any }
          ]}>
            <View style={boardStyles.baseInner}>
              {BASE_PADS.map((pad, i) => (
                <View key={i} style={[
                  boardStyles.basePad,
                  { borderColor: COLOR_BORDER[p] },
                  { left: `${((pad.x - 1.1) / 3.8) * 100}%` as any, top: `${((pad.y - 1.1) / 3.8) * 100}%` as any, width: '26%', height: '26%' }
                ]} />
              ))}
            </View>
          </View>
        );
      })}

      {/* Track Cells */}
      {PATH.map((cell, i) => {
        const start = PLAYERS.find(p => START_INDEX[p] === i) || null;
        const isStar = STAR_CELLS.has(i);
        const CELL = 100/15;
        return (
          <View key={`track-${i}`} style={[
            boardStyles.trackCell,
            { backgroundColor: start ? COLOR_BG[start] : 'rgba(255,255,255,0.05)' },
            { left: `${cell.x * CELL + 0.25}%` as any, top: `${cell.y * CELL + 0.25}%` as any, width: `${CELL - 0.5}%` as any, height: `${CELL - 0.5}%` as any }
          ]}>
            {(isStar || start) && (
              <MaterialIcons name="star" size={14} color={start ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.3)'} />
            )}
          </View>
        );
      })}

      {/* Home Columns */}
      {PLAYERS.map(p => 
        HOME_COLUMN[p].map((cell, i) => {
          const CELL = 100/15;
          return (
            <View key={`home-${p}-${i}`} style={[
              boardStyles.trackCell,
              { backgroundColor: COLOR_SOFT[p] },
              { left: `${cell.x * CELL + 0.25}%` as any, top: `${cell.y * CELL + 0.25}%` as any, width: `${CELL - 0.5}%` as any, height: `${CELL - 0.5}%` as any }
            ]} />
          );
        })
      )}

      {/* Center Home SVG */}
      <View style={[
        { position: 'absolute', overflow: 'hidden', borderRadius: 8 },
        { left: `${6 * 100/15}%` as any, top: `${6 * 100/15}%` as any, width: `${3 * 100/15}%` as any, height: `${3 * 100/15}%` as any }
      ]}>
        <Svg viewBox="0 0 100 100" width="100%" height="100%">
          <Polygon points="0,0 50,50 0,100" fill={COLOR_FILL.red} opacity="0.85" />
          <Polygon points="0,0 100,0 50,50" fill={COLOR_FILL.green} opacity="0.85" />
          <Polygon points="100,0 100,100 50,50" fill={COLOR_FILL.yellow} opacity="0.85" />
          <Polygon points="0,100 50,50 100,100" fill={COLOR_FILL.blue} opacity="0.85" />
          <Circle cx="50" cy="50" r="12" fill="#F5F5F5" opacity="0.9" />
        </Svg>
      </View>

      {/* Tokens */}
      {PLAYERS.map(p => {
        const pTokens = room.tokens.filter(t => t.color === p);
        return pTokens.map(t => {
          const cell = cellForProgress(p, t.position, t.index);
          const key = `${cell.x},${cell.y}`;
          const stackIndex = occupancy.get(key) ?? 0;
          occupancy.set(key, stackIndex + 1);
          
          return (
            <TokenView 
              key={t.id} 
              color={p} 
              progress={t.position} 
              index={t.index} 
              movable={legalIdsSet.has(t.id)} 
              onPress={() => onMove(t.id)}
              stackOffset={stackIndex * 0.9} 
            />
          );
        });
      })}
    </View>
  );
}

const boardStyles = StyleSheet.create({
  container: {
    width: BOARD_SIZE, height: BOARD_SIZE,
    backgroundColor: '#0F172A',
    borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.5, shadowRadius: 20, elevation: 15,
    alignSelf: 'center', marginVertical: 10
  },
  baseQuadrant: { position: 'absolute', borderRadius: 16, borderWidth: 2, padding: '4%' },
  baseInner: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', borderRadius: 12 },
  basePad: { position: 'absolute', borderRadius: 999, borderWidth: 2, opacity: 0.4 },
  trackCell: { position: 'absolute', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
});

// ── Player Panel ──────────────────────────────────────────────────────────────

function PlayerPanel({ player, color, tokens, isActive, rank }: { player: LudoPlayer | null, color: TokenColor, tokens: Token[], isActive: boolean, rank: number | null }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (isActive) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.05, duration: 800, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulse.setValue(1);
    }
  }, [isActive]);

  const pTokens = tokens.filter(t => t.color === color);
  
  return (
    <Animated.View style={[panelStyles.container, { transform: [{ scale: pulse }], borderColor: isActive ? COLOR_BG[color] : 'rgba(255,255,255,0.1)' }]}>
      <View style={panelStyles.row}>
        {player ? <GengalAvatar data={player.avatarData} size={32} /> : <View style={panelStyles.emptyAvatar}><Text style={panelStyles.emptyText}>Open</Text></View>}
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={panelStyles.name} numberOfLines={1}>{player?.nickname || PLAYER_NAMES[color]}</Text>
          <Text style={panelStyles.colorName}>{color.toUpperCase()}</Text>
        </View>
        {rank !== null && <Text style={[panelStyles.rank, { color: COLOR_BG[color] }]}>#{rank}</Text>}
      </View>
      <View style={panelStyles.tokensRow}>
        {pTokens.map((t, i) => (
          <View key={i} style={[panelStyles.smallToken, { backgroundColor: t.position === HOME_PROGRESS ? COLOR_BG[color] : 'rgba(255,255,255,0.1)' }]} />
        ))}
      </View>
    </Animated.View>
  );
}

const panelStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'rgba(15,23,42,0.8)', borderRadius: 16, padding: 10, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  emptyAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 9, color: 'rgba(255,255,255,0.5)' },
  name: { color: '#F5F5F5', fontSize: 13, fontWeight: 'bold' },
  colorName: { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '600' },
  rank: { fontSize: 16, fontWeight: '900' },
  tokensRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  smallToken: { width: 14, height: 14, borderRadius: 7 },
});

// ── Control Bar & Dice ───────────────────────────────────────────────────────

function ControlBar({ room, onRoll, rolling, disabled, myUid }: { room: LudoRoom, onRoll: () => void, rolling: boolean, disabled: boolean, myUid: string }) {
  const currentP = room.players.find(p => p.color === room.currentTurn);
  const name = currentP?.nickname || PLAYER_NAMES[room.currentTurn];
  
  const rot = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const [displayVal, setDisplayVal] = useState(room.diceValue ?? 1);

  useEffect(() => {
    if (rolling) {
      const interval = setInterval(() => setDisplayVal(Math.floor(Math.random() * 6) + 1), 80);
      Animated.loop(Animated.sequence([
        Animated.timing(rot, { toValue: 1, duration: 150, useNativeDriver: true }),
        Animated.timing(rot, { toValue: -1, duration: 150, useNativeDriver: true }),
      ])).start();
      Animated.loop(Animated.sequence([
        Animated.timing(scale, { toValue: 1.15, duration: 100, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 0.9, duration: 100, useNativeDriver: true }),
      ])).start();
      return () => { clearInterval(interval); if (room.diceValue) setDisplayVal(room.diceValue); };
    } else {
      rot.setValue(0); scale.setValue(1);
      if (room.diceValue) setDisplayVal(room.diceValue);
    }
  }, [rolling, room.diceValue]);

  const spin = rot.interpolate({ inputRange: [-1, 1], outputRange: ['-20deg', '20deg'] });

  const DOTS: Record<number, [number, number][]> = {
    1: [[50, 50]], 2: [[25, 25], [75, 75]], 3: [[25, 25], [50, 50], [75, 75]],
    4: [[25, 25], [75, 25], [25, 75], [75, 75]], 5: [[25, 25], [75, 25], [50, 50], [25, 75], [75, 75]],
    6: [[25, 22], [75, 22], [25, 50], [75, 50], [25, 78], [75, 78]],
  };
  const dots = DOTS[displayVal] || DOTS[1];
  const size = 56;
  const dotR = size * 0.09;

  return (
    <View style={ctrlStyles.bar}>
      <View style={{ flex: 1 }}>
        <Text style={ctrlStyles.header}>{room.phase === 'finished' ? 'GAME OVER' : 'CURRENT TURN'}</Text>
        <Text style={[ctrlStyles.name, { color: COLOR_BG[room.currentTurn] }]}>{name}</Text>
        <Text style={ctrlStyles.msg}>{(!room.diceRolled && room.phase === 'playing' && !rolling) ? 'Tap the dice to roll' : ''}</Text>
      </View>
      
      <TouchableOpacity onPress={onRoll} disabled={disabled} activeOpacity={0.7} style={[ctrlStyles.diceWrap, disabled && { opacity: 0.5 }]}>
        <Animated.View style={{ transform: [{ rotate: spin }, { scale }], width: size, height: size, backgroundColor: COLOR_BG[room.currentTurn], borderRadius: 12, shadowColor: COLOR_BG[room.currentTurn], shadowOpacity: 0.8, shadowRadius: 10, elevation: 10 }}>
          {dots.map(([cx, cy], i) => (
            <View key={i} style={{ position: 'absolute', width: dotR*2, height: dotR*2, borderRadius: dotR, backgroundColor: '#FFF', left: (cx/100)*size - dotR, top: (cy/100)*size - dotR }} />
          ))}
        </Animated.View>
      </TouchableOpacity>
    </View>
  );
}

const ctrlStyles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(15,23,42,0.8)', padding: 16, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', marginHorizontal: 20, marginVertical: 10 },
  header: { fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5, marginBottom: 4 },
  name: { fontSize: 20, fontWeight: '900', marginBottom: 2 },
  msg: { fontSize: 12, color: 'rgba(255,255,255,0.6)' },
  diceWrap: { alignItems: 'center', justifyContent: 'center', padding: 8 }
});

function WinModal({ room, myUid, onClose }: { room: LudoRoom, myUid: string, onClose: () => void }) {
  const winner = room.players.find(p => p.uid === room.winnersOrder[0]);
  const iWon = room.winnersOrder[0] === myUid;
  return (
    <View style={wmStyles.overlay}>
      <View style={wmStyles.card}>
        <Text style={wmStyles.emoji}>{iWon ? '🏆' : '🎲'}</Text>
        <Text style={wmStyles.title}>{iWon ? 'You Won!' : `${winner?.nickname ?? 'Someone'} Won!`}</Text>
        <View style={wmStyles.rankList}>
          {room.winnersOrder.map((uid, i) => {
            const p = room.players.find(pl => pl.uid === uid);
            return (
              <View key={uid} style={wmStyles.rankRow}>
                <Text style={wmStyles.rankNum}>#{i + 1}</Text>
                <View style={[wmStyles.colorDot, { backgroundColor: COLOR_BG[p?.color ?? 'red'] }]} />
                <Text style={wmStyles.rankName}>{p?.nickname ?? uid}</Text>
              </View>
            );
          })}
        </View>
        <TouchableOpacity style={wmStyles.btn} onPress={onClose}>
          <Text style={wmStyles.btnText}>Leave Room</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const wmStyles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(10,26,10,0.88)', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 100 },
  card: { width: '100%', maxWidth: 320, backgroundColor: '#0D2B14', borderRadius: 24, padding: 26, alignItems: 'center', gap: 12, borderWidth: 1, borderColor: 'rgba(94,187,98,0.3)' },
  emoji: { fontSize: 48 },
  title: { color: '#FFFDF8', fontSize: 24, fontWeight: '900' },
  rankList: { width: '100%', gap: 8 },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rankNum: { color: '#D4B142', fontSize: 14, fontWeight: '900', width: 28 },
  colorDot: { width: 10, height: 10, borderRadius: 5 },
  rankName: { color: '#FFFDF8', fontSize: 14, fontWeight: '700' },
  btn: { width: '100%', height: 48, borderRadius: 24, backgroundColor: '#1A6B33', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  btnText: { color: '#FFFDF8', fontSize: 15, fontWeight: '900' }
});

export default function LudoBoardScreen({ navigate, goBack, route }: Props) {
  const roomId = route?.params?.roomId ?? '';
  const { profile } = useUser();
  const myUid = auth.currentUser?.uid ?? '';
  const myName = profile?.nickname || profile?.username || 'Guest';
  const myAvatarData = profile?.avatarData;

  const [room, setRoom] = useState<LudoRoom | null>(null);
  const [events, setEvents] = useState<LudoEvent[]>([]);
  const [chatText, setChatText] = useState('');
  const [rolling, setRolling] = useState(false);
  const [movingToken, setMovingToken] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [asSpectator, setAsSpectator] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const [captureFlash, setCaptureFlash] = useState(false);
  const chatRef = useRef<ScrollView>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(15);
  const captureAnim = useRef(new Animated.Value(0)).current;

  const myPlayer = room?.players.find(p => p.uid === myUid) ?? null;
  const isHost = room?.hostUid === myUid;
  const isMyTurn = myPlayer?.color === room?.currentTurn;

  // Derived: which tokens can I move?
  const legalMoveIds = useMemo(() => {
    if (!room || !isMyTurn || !room.diceRolled || room.diceValue === null) return [];
    return getLegalMoves(room.tokens, room.currentTurn, room.diceValue);
  }, [room, isMyTurn]);

  // Subscribe
  useEffect(() => {
    if (!roomId) return;
    const unsub = subscribeToLudoRoom(roomId, setRoom);
    return unsub;
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    const unsub = subscribeToLudoEvents(roomId, (evts) => setEvents([...evts].reverse()));
    return unsub;
  }, [roomId]);

  // Join on mount
  useEffect(() => {
    if (!roomId || !myUid) return;
    joinLudoRoom(roomId, myUid, myName, myAvatarData).then(({ asSpectator: spec }) => {
      setAsSpectator(spec);
    });
    return () => {
      leaveLudoRoom(roomId, myUid, myName, asSpectator);
    };
  }, [roomId]);

  // Auto-scroll chat
  useEffect(() => {
    chatRef.current?.scrollToEnd({ animated: true });
  }, [events]);

  // Turn timer (host-authoritative skip on timeout)
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!room?.turnStartedAt || room.phase !== 'playing') return;
    const endsAt = room.turnStartedAt.toMillis() + room.turnTimeoutSecs * 1000;
    const tick = () => {
      const rem = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setSecondsLeft(rem);
      if (rem === 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        if (isHost && room) skipTurn(roomId, room);
      }
    };
    tick();
    timerRef.current = setInterval(tick, 500);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [room?.currentTurn, room?.turnStartedAt]);

  // Capture flash
  useEffect(() => {
    const lastEvent = events[events.length - 1];
    if (lastEvent?.type === 'capture') {
      setCaptureFlash(true);
      Animated.sequence([
        Animated.timing(captureAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
        Animated.timing(captureAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.timing(captureAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
        Animated.timing(captureAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start(() => setCaptureFlash(false));
    }
  }, [events.length]);

  // Actions
  const handleRoll = useCallback(async () => {
    if (!room || rolling || room.diceRolled || !isMyTurn) return;
    setRolling(true);
    try {
      await rollDice(roomId, myUid, myName, myAvatarData, room);
    } finally {
      setRolling(false);
    }
  }, [room, rolling, isMyTurn, roomId, myUid, myName, myAvatarData]);

  const handleTokenPress = useCallback(async (tokenId: string) => {
    if (!room || movingToken || !room.diceRolled) return;
    setMovingToken(tokenId);
    try {
      await moveToken(roomId, myUid, myName, myAvatarData, tokenId, room);
    } finally {
      setMovingToken(null);
    }
  }, [room, movingToken, roomId, myUid, myName, myAvatarData]);

  const handleSendChat = useCallback(async () => {
    if (!chatText.trim() || !roomId) return;
    setSending(true);
    try {
      await sendLudoChat(roomId, myUid, myName, myAvatarData, chatText.trim());
      setChatText('');
    } finally {
      setSending(false);
    }
  }, [chatText, roomId, myUid, myName, myAvatarData]);

  const handleGift = useCallback(async (gift: typeof LUDO_GIFTS[0]) => {
    if (!room) return;
    const target = room.players.find(p => p.uid !== myUid);
    if (!target) return;
    try {
      await sendLudoGift(roomId, myUid, myName, myAvatarData, target.uid, gift.name, gift.cost);
    } catch { /* insufficient coins */ }
  }, [room, roomId, myUid, myName, myAvatarData]);

  const handleLeave = useCallback(async () => {
    await leaveLudoRoom(roomId, myUid, myName, asSpectator);
    if (isHost) await closeLudoRoom(roomId);
    goBack?.();
  }, [roomId, myUid, myName, asSpectator, isHost]);

  if (!room) {
    return (
      <ScreenShell tone="dark">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color="#5EBB62" size="large" />
        </View>
      </ScreenShell>
    );
  }

  const isGameOver = room.phase === 'finished';
  const canRoll = isMyTurn && !room.diceRolled && room.phase === 'playing' && !asSpectator;
  const activePlayer = room.players.find(p => p.color === room.currentTurn);

  // Map color→player for corners
  const byColor = Object.fromEntries(room.players.map(p => [p.color, p])) as Partial<Record<TokenColor, LudoPlayer>>;



  return (
    <ScreenShell>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={newStyles.container}>
          {/* Header */}
          <View style={newStyles.header}>
            <View>
              <Text style={newStyles.royal}>ROYAL</Text>
              <Text style={newStyles.ludoTitle}>Ludo</Text>
            </View>
            <TouchableOpacity onPress={() => startGame(roomId)} style={newStyles.newGameBtn}>
              <MaterialIcons name="refresh" size={16} color="rgba(255,255,255,0.6)" />
              <Text style={newStyles.newGameText}>New Game</Text>
            </TouchableOpacity>
          </View>

          {/* Top Players */}
          <View style={newStyles.panelsRow}>
            <PlayerPanel player={room.players.find(p => p.color === 'red') || null} color="red" tokens={room.tokens} isActive={room.currentTurn === 'red'} rank={room.winnersOrder.indexOf(room.players.find(p => p.color === 'red')?.uid || '') > -1 ? room.winnersOrder.indexOf(room.players.find(p => p.color === 'red')?.uid || '') + 1 : null} />
            <PlayerPanel player={room.players.find(p => p.color === 'green') || null} color="green" tokens={room.tokens} isActive={room.currentTurn === 'green'} rank={room.winnersOrder.indexOf(room.players.find(p => p.color === 'green')?.uid || '') > -1 ? room.winnersOrder.indexOf(room.players.find(p => p.color === 'green')?.uid || '') + 1 : null} />
          </View>

          {/* Board */}
          <Board room={room} myPlayer={myPlayer} onMove={handleTokenPress} />

          {/* Bottom Players */}
          <View style={newStyles.panelsRow}>
            <PlayerPanel player={room.players.find(p => p.color === 'blue') || null} color="blue" tokens={room.tokens} isActive={room.currentTurn === 'blue'} rank={room.winnersOrder.indexOf(room.players.find(p => p.color === 'blue')?.uid || '') > -1 ? room.winnersOrder.indexOf(room.players.find(p => p.color === 'blue')?.uid || '') + 1 : null} />
            <PlayerPanel player={room.players.find(p => p.color === 'yellow') || null} color="yellow" tokens={room.tokens} isActive={room.currentTurn === 'yellow'} rank={room.winnersOrder.indexOf(room.players.find(p => p.color === 'yellow')?.uid || '') > -1 ? room.winnersOrder.indexOf(room.players.find(p => p.color === 'yellow')?.uid || '') + 1 : null} />
          </View>

          {/* Control Bar */}
          <ControlBar room={room} onRoll={handleRoll} rolling={rolling} disabled={!isMyTurn || room.diceRolled} myUid={myUid} />

          {/* Chat (Kept for functionality) */}
          <View style={newStyles.chatContainer}>
            <ScrollView ref={chatRef} style={newStyles.chatScroll} onContentSizeChange={() => chatRef.current?.scrollToEnd({ animated: true })}>
              {events.filter(e => e.type === 'chat').map((e, i) => (
                <View key={e.id || i} style={{ flexDirection: 'row', marginBottom: 4 }}>
                  <Text style={{ color: e.senderUid === myUid ? COLOR_BG.blue : COLOR_BG.yellow, fontWeight: 'bold', fontSize: 12 }}>{e.senderName}: </Text>
                  <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>{e.text}</Text>
                </View>
              ))}
            </ScrollView>
            <View style={newStyles.chatInputRow}>
              <TextInput style={newStyles.chatInput} value={chatText} onChangeText={setChatText} placeholder="Say something..." placeholderTextColor="rgba(255,255,255,0.3)" onSubmitEditing={handleSendChat} />
              <TouchableOpacity onPress={handleSendChat} style={newStyles.sendBtn}>
                <MaterialIcons name="send" size={16} color="#FFF" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

      {room.phase === 'finished' && (
        <WinModal room={room} myUid={myUid} onClose={handleLeave} />
      )}
    </ScreenShell>
  );
}

const newStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B1121' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 5 },
  royal: { fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: 3, color: 'rgba(255,255,255,0.5)' },
  ludoTitle: { fontSize: 28, fontWeight: 'bold', color: '#F5F5F5' },
  newGameBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(15,23,42,0.8)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  newGameText: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.6)' },
  panelsRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, marginVertical: 4 },
  chatContainer: { flex: 1, marginHorizontal: 20, marginBottom: 10, backgroundColor: 'rgba(15,23,42,0.5)', borderRadius: 16, padding: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  chatScroll: { flex: 1, marginBottom: 8 },
  chatInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chatInput: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, color: '#FFF', fontSize: 12 },
  sendBtn: { backgroundColor: COLOR_BG.blue, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }
});
