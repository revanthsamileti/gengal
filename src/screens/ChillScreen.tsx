import { Alert } from '../components/CustomAlert';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import ScreenShell from '../components/ScreenShell';
import TopBar from '../components/TopBar';
import BottomNav from '../components/BottomNav';
import GengalAvatar from '../components/GengalAvatar';
import RosterStrip from '../components/rooms/RosterStrip';
import {
  explainLudoBusy, LudoJoinByCode, LudoOpenSheet, LudoTableCard, Pawn, SEAT_ORDER, sheetStyles, useLudoTerms,
} from '../components/ludo/LudoLobby';
import { skeuo } from '../theme/skeuomorphic';
import { numeric } from '../theme/ludoTheme';
import { auth } from '../config/firebase';
import { useUser } from '../context/UserContext';
import {
  ChillRoom, CHILL_LANGUAGES,
  subscribeToChillRooms,
  createChillRoom,
} from '../services/chillService';
import { useLiveRooms } from '../hooks/useRoomPresence';
import {
  LudoRoom,
  subscribeToLudoRooms,
  createLudoRoom,
  joinLudoRoom,
} from '../services/ludoService';

interface Props {
  navigate: (screen: string, params?: any) => void;
  goBack?: () => void;
}

type ActiveGame = 'charades' | 'ludo';

/**
 * Each game keeps one colour throughout the lobby — its tab, its primary
 * button, its empty state — so which game you are looking at is never in doubt.
 * Both inks clear 4.5:1 against white text and against the cream page.
 */
const GAME = {
  ludo: { ink: '#1A6B33', wash: '#E3F3DA', border: '#BFDDB0', icon: 'casino' },
  charades: { ink: '#5B0068', wash: '#F4E1F7', border: '#DCC0E4', icon: 'theaters' },
} as const;

/** Rooms in these phases are still worth walking into. */
const CHARADES_PHASE: Record<string, { label: string; live: boolean }> = {
  waiting: { label: 'OPEN', live: false },
  prompt: { label: 'STARTING', live: true },
  acting: { label: 'PLAYING', live: true },
  result: { label: 'ROUND END', live: true },
};

// ── Shared bits ───────────────────────────────────────────────────────────────

function useFadeIn() {
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true,
    }).start();
  }, [fade]);
  return fade;
}

function PrimaryButton({
  label, icon, color, onPress, busy, accessibilityLabel, wide,
}: {
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  color: string;
  onPress: () => void;
  busy?: boolean;
  accessibilityLabel?: string;
  wide?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ busy: !!busy, disabled: !!busy }}
      style={({ pressed }) => [
        styles.primary,
        wide && styles.primaryWide,
        { backgroundColor: color },
        (pressed || busy) && styles.primaryPressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color="#FFFDF8" />
      ) : (
        <>
          <MaterialIcons name={icon} size={18} color="#FFFDF8" />
          <Text style={[styles.primaryText, numeric]} numberOfLines={1}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

/** Loading, failed and empty all get a card, so the list never just vanishes. */
function ListState({
  kind, game, title, body, action,
}: {
  kind: 'loading' | 'error' | 'empty';
  game: ActiveGame;
  title?: string;
  body?: string;
  action?: React.ReactNode;
}) {
  const g = GAME[game];
  if (kind === 'loading') {
    return (
      <View style={styles.state} accessibilityLiveRegion="polite">
        <ActivityIndicator color={g.ink} />
        <Text style={styles.stateBody}>Finding rooms…</Text>
      </View>
    );
  }
  return (
    <View style={styles.state} accessibilityLiveRegion="polite">
      {kind === 'error' ? (
        <View style={[styles.stateIcon, { backgroundColor: '#FBE4E2' }]}>
          <MaterialIcons name="wifi-off" size={26} color="#A3322B" />
        </View>
      ) : game === 'ludo' ? (
        <View style={styles.statePawns}>
          {SEAT_ORDER.map((c) => <Pawn key={c} color={c} size={22} />)}
        </View>
      ) : (
        <View style={[styles.stateIcon, { backgroundColor: g.wash }]}>
          <MaterialIcons name="theaters" size={26} color={g.ink} />
        </View>
      )}
      {title ? <Text style={styles.stateTitle} accessibilityRole="header">{title}</Text> : null}
      {body ? <Text style={styles.stateBody}>{body}</Text> : null}
      {action}
    </View>
  );
}

// ── Game switcher ─────────────────────────────────────────────────────────────

function GameTab({
  game, title, live, loaded, selected, onPress,
}: {
  game: ActiveGame;
  title: string;
  live: number;
  loaded: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const g = GAME[game];
  const liveText = !loaded ? '…' : live === 0 ? 'No rooms' : `${live} live`;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}, ${loaded ? (live === 1 ? '1 room live' : `${live} rooms live`) : 'loading'}`}
      style={({ pressed }) => [
        styles.tab,
        selected && { backgroundColor: '#FFFFFF', borderColor: g.border },
        selected && styles.tabSelected,
        pressed && !selected && styles.tabPressed,
      ]}
    >
      <View style={[styles.tabIcon, { backgroundColor: selected ? g.wash : '#EFE6D8' }]}>
        <MaterialIcons name={g.icon} size={22} color={selected ? g.ink : '#8B7A6A'} />
      </View>
      <View style={styles.tabMeta}>
        <Text style={[styles.tabTitle, selected && { color: g.ink }]} numberOfLines={1}>{title}</Text>
        <View style={styles.tabLiveRow}>
          {loaded && live > 0 && <View style={[styles.tabDot, { backgroundColor: selected ? g.ink : '#5EBB62' }]} />}
          <Text style={[styles.tabLive, numeric]} numberOfLines={1}>{liveText}</Text>
        </View>
      </View>
    </Pressable>
  );
}

// ── Dumb Charades room card ───────────────────────────────────────────────────

function CharadesRoomCard({ room, onJoin }: { room: ChillRoom; onJoin: () => void }) {
  const fade = useFadeIn();
  const phase = CHARADES_PHASE[room.phase] ?? CHARADES_PHASE.waiting;
  const people = room.activeMemberCount === 1 ? '1 player' : `${room.activeMemberCount} players`;

  return (
    <Animated.View style={{ opacity: fade }}>
      <Pressable
        onPress={onJoin}
        accessibilityRole="button"
        accessibilityLabel={
          `${room.hostNickname}'s charades room in ${room.language}, ${people}, ` +
          `${phase.live ? 'game in progress' : 'waiting to start'}. Free to join.`
        }
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      >
        <View style={styles.cardHead}>
          <View style={styles.cardAvatar}>
            <GengalAvatar data={room.hostAvatarData} size={40} />
          </View>
          <View style={styles.cardMeta}>
            <Text style={styles.cardHost} numberOfLines={1}>{room.hostNickname}</Text>
            <Text style={[styles.cardSub, numeric]} numberOfLines={1}>{room.language} · {people}</Text>
          </View>
          <View style={[styles.status, phase.live && styles.statusLive]}>
            {phase.live && <View style={styles.statusDot} />}
            <Text style={[styles.statusText, phase.live && styles.statusTextLive]}>{phase.label}</Text>
          </View>
        </View>

        {/* Who is actually in there right now, from the host's roster preview. */}
        <RosterStrip roster={room.roster} count={room.activeMemberCount} size={24} tone="light" />

        <View style={styles.cardFoot}>
          <Text style={styles.cardFootText}>Free to join</Text>
          <View style={[styles.cardCta, { backgroundColor: GAME.charades.ink }]}>
            <MaterialIcons name="login" size={15} color="#FFFDF8" />
            <Text style={styles.cardCtaText}>Join room</Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ── Host Dumb Charades sheet ──────────────────────────────────────────────────

function CharadesSheet({
  visible, initialLanguage, onClose, onCreate,
}: {
  visible: boolean;
  initialLanguage: string | null;
  onClose: () => void;
  onCreate: (language: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState(initialLanguage ?? 'Hindi');
  const [loading, setLoading] = useState(false);

  // Opening the sheet while a language filter is on starts from that language.
  useEffect(() => {
    if (visible) setSelected(initialLanguage ?? 'Hindi');
  }, [visible, initialLanguage]);

  const handleCreate = useCallback(async () => {
    setLoading(true);
    try { await onCreate(selected); } finally { setLoading(false); }
  }, [selected, onCreate]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={sheetStyles.root}>
        <Pressable
          style={sheetStyles.scrim}
          onPress={loading ? undefined : onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <View style={sheetStyles.sheet}>
          <View style={sheetStyles.grip} />
          <Text style={sheetStyles.title} accessibilityRole="header">Host Dumb Charades</Text>
          <Text style={sheetStyles.body}>
            Pick a language. Every movie to act out comes from that language. Hosting is free.
          </Text>

          {/* All ten fit on one screen as a grid; the old scrolling list cut
              the last few off with nothing to say there were more. */}
          <View style={styles.langGrid} accessibilityRole="radiogroup">
            {CHILL_LANGUAGES.map((lang) => {
              const on = selected === lang;
              return (
                <Pressable
                  key={lang}
                  onPress={() => setSelected(lang)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  style={({ pressed }) => [styles.langChip, on && styles.langChipOn, pressed && styles.langChipPressed]}
                >
                  {on && <MaterialIcons name="check" size={16} color="#FFFDF8" />}
                  <Text style={[styles.langText, on && styles.langTextOn]}>{lang}</Text>
                </Pressable>
              );
            })}
          </View>

          <PrimaryButton
            wide
            label={`Create ${selected} room`}
            icon="play-arrow"
            color={GAME.charades.ink}
            busy={loading}
            onPress={handleCreate}
          />
          <Pressable
            onPress={onClose}
            disabled={loading}
            accessibilityRole="button"
            style={({ pressed }) => [sheetStyles.cancel, pressed && sheetStyles.pressed]}
          >
            <Text style={sheetStyles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function ChillScreen({ navigate }: Props) {
  const { profile } = useUser();
  const myUid = auth.currentUser?.uid ?? '';
  const myName = profile?.nickname || profile?.username || 'Guest';
  const myAvatarData = profile?.avatarData;

  const [activeGame, setActiveGame] = useState<ActiveGame>('ludo');
  const ludoTerms = useLudoTerms();
  const [langFilter, setLangFilter] = useState<string | null>(null);
  /** Bumped by "Try again" to tear down and reopen both lobby listeners. */
  const [retry, setRetry] = useState(0);

  const [allCharadeRooms, setAllCharadeRooms] = useState<ChillRoom[]>([]);
  // Rooms whose host stopped heartbeating are abandoned, whatever `status` says.
  const liveCharadeRooms = useLiveRooms(allCharadeRooms).filter((r) => r.phase !== 'finished');
  // The language filter is applied here rather than in the query, so the tab
  // can keep counting every room and switching language needs no reload.
  const charadeRooms = langFilter
    ? liveCharadeRooms.filter((r) => r.language === langFilter)
    : liveCharadeRooms;
  const [allLudoRooms, setLudoRooms] = useState<LudoRoom[]>([]);
  // Same filter as the charades list and LudoScreen. Without it this lobby
  // listed a table whose host had left nine hours earlier as "1 live", and
  // everyone who joined waited for a game nobody could start.
  // A finished game has nothing left to join.
  const ludoRooms = useLiveRooms(allLudoRooms).filter((r) => r.phase !== 'finished');

  // "No rooms yet", "we haven't heard back yet" and "the request failed" all
  // look like an empty list, so each lobby tracks which one it is.
  const [charadesLoaded, setCharadesLoaded] = useState(false);
  const [ludoLoaded, setLudoLoaded] = useState(false);
  const [charadesError, setCharadesError] = useState(false);
  const [ludoError, setLudoError] = useState(false);

  const [charadesSheet, setCharadesSheet] = useState(false);
  const [ludoSheet, setLudoSheet] = useState(false);
  const [creatingLudo, setCreatingLudo] = useState(false);
  const [joiningLudoId, setJoiningLudoId] = useState<string | null>(null);

  useEffect(() => {
    setCharadesError(false);
    return subscribeToChillRooms(
      (rooms) => {
        setAllCharadeRooms(rooms);
        setCharadesLoaded(true);
        setCharadesError(false);
      },
      undefined,
      () => {
        setCharadesError(true);
        setCharadesLoaded(true);
      },
    );
  }, [retry]);

  useEffect(() => {
    setLudoError(false);
    return subscribeToLudoRooms(
      (rooms) => {
        setLudoRooms(rooms);
        setLudoLoaded(true);
        setLudoError(false);
      },
      () => {
        setLudoError(true);
        setLudoLoaded(true);
      },
    );
  }, [retry]);

  // ── Dumb Charades actions
  const handleCreateCharades = useCallback(async (language: string) => {
    try {
      const roomId = await createChillRoom(myUid, myName, myAvatarData, language);
      setCharadesSheet(false);
      navigate('DumCharadesRoom', { roomId });
    } catch (e: any) {
      Alert.alert('Could not create the room', e?.message || 'Check your connection and try again.');
    }
  }, [myUid, myName, myAvatarData, navigate]);

  const handleJoinCharades = useCallback((room: ChillRoom) => {
    if (!room.id) return;
    navigate('DumCharadesRoom', { roomId: room.id });
  }, [navigate]);

  // ── Ludo actions
  const openLudoSheet = useCallback(() => {
    // Say so before the sheet, not after the player has read the rules.
    if ((profile?.coins ?? 0) < ludoTerms.deposit) {
      Alert.alert(
        'Not enough coins',
        `Opening a table takes a ${ludoTerms.deposit}-coin deposit. Top up in the store, or join a table that is already open.`,
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Get coins', onPress: () => navigate('Coins') },
        ],
      );
      return;
    }
    setLudoSheet(true);
  }, [profile, navigate, ludoTerms.deposit]);

  const handleCreateLudo = useCallback(async (opts: { private: boolean }) => {
    setLudoSheet(false);
    setCreatingLudo(true);
    try {
      const roomId = await createLudoRoom(myUid, myName, myAvatarData, 'per_minute', opts);
      navigate('LudoBoard', { roomId });
    } catch (e: any) {
      if (explainLudoBusy(e, navigate)) return;
      Alert.alert('Could not open a table', e?.message || 'Check your connection and try again.');
    } finally {
      setCreatingLudo(false);
    }
  }, [myUid, myName, myAvatarData, navigate]);

  const handleJoinLudo = useCallback(async (room: LudoRoom) => {
    if (!room.id || joiningLudoId) return;
    setJoiningLudoId(room.id);
    try {
      const { joined } = await joinLudoRoom(room.id, myUid, myName, myAvatarData);
      // joined is false only when the table no longer exists -- a lobby
      // card that outlived its room. Doing nothing here left the button
      // spinning and then simply stopping, with no screen and no reason.
      if (!joined) {
        Alert.alert('That table has closed', 'It closed before you could join. Pick another one or open your own.');
        return;
      }
      // takeSeat: the card said "Take a seat", so arrive with one offered.
      navigate('LudoBoard', { roomId: room.id, takeSeat: true });
    } catch (e: any) {
      Alert.alert('Could not open that table', e?.message || 'Check your connection and try again.');
    } finally {
      setJoiningLudoId(null);
    }
  }, [myUid, myName, myAvatarData, navigate, joiningLudoId]);

  const isCharades = activeGame === 'charades';
  const g = GAME[activeGame];
  const tryAgain = (
    <PrimaryButton label="Try again" icon="refresh" color={g.ink} onPress={() => setRetry((n) => n + 1)} />
  );

  const ludoCta = (
    <PrimaryButton
      label={`Open a table · ${ludoTerms.deposit}`}
      icon="add"
      color={GAME.ludo.ink}
      busy={creatingLudo}
      onPress={openLudoSheet}
      accessibilityLabel={`Open a Ludo table, ${ludoTerms.deposit} coin deposit`}
    />
  );
  const charadesCta = (
    <PrimaryButton
      label="Host a room"
      icon="add"
      color={GAME.charades.ink}
      onPress={() => setCharadesSheet(true)}
      accessibilityLabel="Host a Dumb Charades room, free"
    />
  );

  return (
    <ScreenShell tone="light">
      <View style={styles.phone}>
        <TopBar navigate={navigate} subtitle="CHILL LOUNGE" />

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          stickyHeaderIndices={[0]}
        >
          {/* The switcher stays pinned so changing game never needs a scroll back up. */}
          <View style={styles.tabsWrap}>
            <View style={styles.tabs} accessibilityRole="tablist">
              <GameTab
                game="ludo"
                title="Ludo"
                live={ludoRooms.length}
                loaded={ludoLoaded && !ludoError}
                selected={!isCharades}
                onPress={() => setActiveGame('ludo')}
              />
              <GameTab
                game="charades"
                title="Charades"
                live={liveCharadeRooms.length}
                loaded={charadesLoaded && !charadesError}
                selected={isCharades}
                onPress={() => setActiveGame('charades')}
              />
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionCopy}>
              <Text style={styles.sectionTitle} accessibilityRole="header">
                {isCharades ? 'Dumb Charades' : 'Ludo tables'}
              </Text>
              <Text style={styles.sectionSub}>
                {isCharades
                  ? 'Act out a movie, guess the rest. Win coins.'
                  : `Seats are free. Players pay ${ludoTerms.rates['1']}–${ludoTerms.rates['3']} coins a minute.`}
              </Text>
            </View>
            {isCharades ? charadesCta : ludoCta}
          </View>
          {!isCharades && (
            // A private table is only reachable this way (or by its link).
            <View style={{ marginHorizontal: 16, marginBottom: 12, alignItems: 'flex-start' }}>
              <LudoJoinByCode navigate={navigate} />
            </View>
          )}

          {isCharades ? (
            <>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filters}
                accessibilityRole="radiogroup"
                accessibilityLabel="Filter by language"
              >
                {[null, ...CHILL_LANGUAGES].map((lang) => {
                  const on = langFilter === lang;
                  return (
                    <Pressable
                      key={lang ?? 'all'}
                      onPress={() => setLangFilter(lang)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={lang ?? 'All languages'}
                      hitSlop={{ top: 4, bottom: 4 }}
                      style={({ pressed }) => [styles.filter, on && styles.filterOn, pressed && styles.langChipPressed]}
                    >
                      <Text style={[styles.filterText, on && styles.filterTextOn]}>{lang ?? 'All'}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <View style={styles.list}>
                {!charadesLoaded ? (
                  <ListState kind="loading" game="charades" />
                ) : charadesError ? (
                  <ListState
                    kind="error"
                    game="charades"
                    title="Couldn't load rooms"
                    body="Check your connection, then try again."
                    action={tryAgain}
                  />
                ) : charadeRooms.length === 0 ? (
                  <ListState
                    kind="empty"
                    game="charades"
                    title={langFilter ? `No ${langFilter} rooms right now` : 'No rooms right now'}
                    body={langFilter
                      ? 'Host one in this language with the button above, or pick All to see every room.'
                      : 'Host the first one with the button above. Friends join for free.'}
                    action={langFilter ? (
                      <Pressable
                        onPress={() => setLangFilter(null)}
                        accessibilityRole="button"
                        style={({ pressed }) => [styles.secondary, pressed && styles.langChipPressed]}
                      >
                        <Text style={styles.secondaryText}>Show all languages</Text>
                      </Pressable>
                    ) : undefined}
                  />
                ) : (
                  charadeRooms.map((room) => (
                    <CharadesRoomCard key={room.id} room={room} onJoin={() => handleJoinCharades(room)} />
                  ))
                )}
              </View>
            </>
          ) : (
            <View style={styles.list}>
              {!ludoLoaded ? (
                <ListState kind="loading" game="ludo" />
              ) : ludoError ? (
                <ListState
                  kind="error"
                  game="ludo"
                  title="Couldn't load tables"
                  body="Check your connection, then try again."
                  action={tryAgain}
                />
              ) : ludoRooms.length === 0 ? (
                <ListState
                  kind="empty"
                  game="ludo"
                  title="No tables open right now"
                  body="Open one with the button above and invite your friends to take a seat."
                />
              ) : (
                ludoRooms.map((room) => (
                  <LudoTableCard
                    key={room.id}
                    room={room}
                    onOpen={() => handleJoinLudo(room)}
                    busy={joiningLudoId === room.id}
                  />
                ))
              )}
            </View>
          )}
        </ScrollView>

        <LudoOpenSheet
          visible={ludoSheet}
          terms={ludoTerms}
          onClose={() => setLudoSheet(false)}
          onConfirm={handleCreateLudo}
        />
        <CharadesSheet
          visible={charadesSheet}
          initialLanguage={langFilter}
          onClose={() => setCharadesSheet(false)}
          onCreate={handleCreateCharades}
        />

        <BottomNav active="Chill" navigate={navigate} />
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  phone: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: 430 },
  scroll: { paddingBottom: 120 },

  // Game switcher
  tabsWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6, backgroundColor: skeuo.surface },
  tabs: {
    flexDirection: 'row',
    gap: 6,
    padding: 5,
    borderRadius: 20,
    backgroundColor: skeuo.surfaceInset,
    borderWidth: 1,
    borderColor: skeuo.border,
  },
  tab: {
    flex: 1,
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  tabSelected: {
    elevation: 3,
    boxShadow: Platform.OS === 'web' ? '0 6px 14px rgba(83,58,29,0.14)' : undefined,
  },
  tabPressed: { backgroundColor: 'rgba(255,255,255,0.5)' },
  tabIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tabMeta: { flex: 1, gap: 2 },
  tabTitle: { color: '#5E5249', fontSize: 15, fontWeight: '900' },
  tabLiveRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tabDot: { width: 7, height: 7, borderRadius: 4 },
  tabLive: { color: '#7E7368', fontSize: 12, fontWeight: '700' },

  // Section header with the game's one primary action
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 10,
  },
  sectionCopy: { flex: 1, gap: 2 },
  sectionTitle: { color: skeuo.plum, fontSize: 21, fontWeight: '900', fontFamily: 'serif' },
  sectionSub: { color: '#7E7368', fontSize: 13, fontWeight: '600', lineHeight: 18 },

  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 46,
    paddingHorizontal: 16,
    borderRadius: 23,
    elevation: 2,
  },
  primaryWide: { alignSelf: 'stretch', height: 52, borderRadius: 26, marginTop: 6 },
  primaryPressed: { opacity: 0.8 },
  primaryText: { color: '#FFFDF8', fontSize: 14, fontWeight: '900' },
  secondary: {
    height: 44, paddingHorizontal: 18, borderRadius: 22, justifyContent: 'center',
    borderWidth: 1.5, borderColor: GAME.charades.ink,
  },
  secondaryText: { color: GAME.charades.ink, fontSize: 14, fontWeight: '900' },

  // Language filter
  filters: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  filter: {
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: 15,
    borderRadius: 18,
    backgroundColor: skeuo.surfaceRaised,
    borderWidth: 1,
    borderColor: skeuo.border,
  },
  filterOn: { backgroundColor: GAME.charades.ink, borderColor: GAME.charades.ink },
  filterText: { color: '#5E5249', fontSize: 13, fontWeight: '800' },
  filterTextOn: { color: '#FFFDF8' },

  list: { paddingHorizontal: 16, gap: 12 },

  // Loading / error / empty
  state: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 30,
    paddingHorizontal: 22,
    borderRadius: 22,
    backgroundColor: skeuo.surfaceRaised,
    borderWidth: 1,
    borderColor: skeuo.border,
  },
  stateIcon: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  statePawns: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  stateTitle: { color: skeuo.plum, fontSize: 18, fontWeight: '900', fontFamily: 'serif', textAlign: 'center' },
  stateBody: {
    color: '#7E7368', fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 19, marginBottom: 6,
  },

  // Charades room card (matches the Ludo table card)
  card: {
    borderRadius: 20,
    padding: 14,
    gap: 12,
    backgroundColor: skeuo.surfaceRaised,
    borderWidth: 1,
    borderColor: skeuo.border,
    elevation: 2,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
  },
  cardPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardAvatar: {
    width: 46, height: 46, borderRadius: 23, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: skeuo.surfaceInset,
    borderWidth: 1.5, borderColor: GAME.charades.border,
  },
  cardMeta: { flex: 1, gap: 2 },
  cardHost: { color: skeuo.plum, fontSize: 16, fontWeight: '900' },
  cardSub: { color: '#7E7368', fontSize: 12, fontWeight: '700' },
  status: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
    borderWidth: 1, borderColor: skeuo.border, backgroundColor: skeuo.surface,
  },
  statusLive: { borderColor: GAME.charades.border, backgroundColor: GAME.charades.wash },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: GAME.charades.ink },
  statusText: { color: '#7E7368', fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  statusTextLive: { color: GAME.charades.ink },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cardFootText: { color: '#7E7368', fontSize: 12, fontWeight: '700' },
  cardCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 44, minWidth: 128, paddingHorizontal: 18, borderRadius: 22,
  },
  cardCtaText: { color: '#FFFDF8', fontSize: 14, fontWeight: '900' },

  // Language picker in the host sheet
  langGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  langChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: skeuo.surface,
    borderWidth: 1,
    borderColor: skeuo.border,
  },
  langChipOn: { backgroundColor: GAME.charades.ink, borderColor: GAME.charades.ink },
  langChipPressed: { opacity: 0.75 },
  langText: { color: '#5E5249', fontSize: 14, fontWeight: '800' },
  langTextOn: { color: '#FFFDF8' },
});
