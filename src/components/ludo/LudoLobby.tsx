import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Svg, { Circle, Defs, Ellipse, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';

import GengalAvatar from '../GengalAvatar';
import { Alert } from '../CustomAlert';
import { auth } from '../../config/firebase';
import { DEFAULT_SETTINGS, getGlobalSettings, GlobalSettings } from '../../services/adminService';
import { isPerMinute, ludoRate, payingPlayers } from '../../services/ludoService';
import type { LudoRoom, LudoTerms, TokenColor } from '../../services/ludoService';
import { GEMS, ludo, numeric } from '../../theme/ludoTheme';
import { skeuo } from '../../theme/skeuomorphic';

/**
 * The pieces of a Ludo lobby, shared by the Chill tab and the Ludo screen so
 * the same table looks and behaves the same from both doors.
 */

/** Board order, clockwise from the top-left seat — same as the table itself. */
export const SEAT_ORDER: TokenColor[] = ['red', 'blue', 'green', 'yellow'];

/** The terms a table opened now would get, from the admin settings. */
export function termsFromSettings(settings: GlobalSettings): LudoTerms {
  return {
    deposit: settings.ludoHostDeposit,
    rates: {
      '1': settings.ludoRateOnePlayer,
      '2': settings.ludoRateTwoPlayers,
      '3': settings.ludoRateThreePlayers,
    },
    hostSharePercent: settings.ludoHostSharePercent,
    forfeitEach: {
      '1': settings.ludoForfeitOnePlayer,
      '2': settings.ludoForfeitTwoPlayers,
      '3': settings.ludoForfeitThreePlayers,
    },
    winnerPrize: settings.ludoWinnerPrize,
    hostMaxLeaves: settings.ludoHostMaxLeaves,
    hostMaxMissed: settings.ludoHostMaxMissedTurns,
    emptyCloseSecs: settings.ludoEmptyCloseMinutes * 60,
  };
}

/**
 * Current table terms for the lobby's prices. Starts on the built-in defaults
 * so the price is never blank, then follows whatever the admin has set.
 */
export function useLudoTerms(): LudoTerms {
  const [terms, setTerms] = useState(() => termsFromSettings(DEFAULT_SETTINGS));
  useEffect(() => {
    let alive = true;
    getGlobalSettings().then((s) => { if (alive) setTerms(termsFromSettings(s)); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return terms;
}

/**
 * The server refused because a game already holds you. Says so plainly and
 * offers the way back to that table rather than a dead end.
 */
export function explainLudoBusy(
  e: any,
  navigate: (screen: string, params?: any) => void,
): boolean {
  if (e?.code !== 'ludo_busy') return false;
  Alert.alert(
    "You're already in a game",
    'Finish your Ludo game before you open or join another table.',
    e.roomId
      ? [
          { text: 'Not now', style: 'cancel' },
          { text: 'Go to my table', onPress: () => navigate('LudoBoard', { roomId: e.roomId }) },
        ]
      : undefined,
  );
  return true;
}

/** The same pawn silhouette as the board, so every screen shares a vocabulary. */
export function Pawn({ color, size = 22 }: { color: TokenColor; size?: number }) {
  const c = GEMS[color];
  return (
    <Svg width={size} height={size * (44 / 40)} viewBox="0 0 40 44">
      <Defs>
        <SvgGradient id={`lp-${color}`} x1="0.2" y1="0" x2="0.85" y2="1">
          <Stop offset="0" stopColor={c.light} />
          <Stop offset="0.45" stopColor={c.core} />
          <Stop offset="1" stopColor={c.dark} />
        </SvgGradient>
      </Defs>
      <Ellipse cx="20" cy="39.5" rx="12" ry="3.2" fill="#000" opacity="0.18" />
      <Path
        d="M20 15 C25.5 15 29 21 30.5 28 C31.8 34 29 38.5 20 38.5 C11 38.5 8.2 34 9.5 28 C11 21 14.5 15 20 15 Z"
        fill={`url(#lp-${color})`} stroke={c.dark} strokeWidth="1.6" strokeLinejoin="round"
      />
      <Circle cx="20" cy="11" r="8" fill={`url(#lp-${color})`} stroke={c.dark} strokeWidth="1.6" />
      <Ellipse cx="16.6" cy="8.2" rx="3.1" ry="3.6" fill="#FFFFFF" opacity="0.55" transform="rotate(-20 16.6 8.2)" />
    </Svg>
  );
}

export function LudoTableCard({
  room, onOpen, busy,
}: { room: LudoRoom; onOpen: () => void; busy: boolean }) {
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true,
    }).start();
  }, [fade]);

  const seated = room.players.length;
  const open = seated < 4 && room.phase === 'waiting';
  const host = room.players.find((p) => p.uid === room.hostUid) ?? room.players[0];
  // Somebody who already holds a seat is going back to their game, not watching.
  const amSeated = room.players.some((p) => p.uid === auth.currentUser?.uid);
  const cta = amSeated ? 'Rejoin' : open ? 'Take a seat' : 'Watch';
  const watching = Math.max(0, (room.presentCount ?? seated) - seated);
  const perMinute = isPerMinute(room);
  const paying = payingPlayers(room).length;
  // A newcomer sees what *they* would pay; everyone else what is being paid now.
  const rate = ludoRate(room.terms, amSeated || !open ? paying : paying + 1);
  const modeName = perMinute
    ? `${rate} coins/min`
    : room.gameMode === 'per_token' ? 'Roll & back' : 'Ticket table';
  const playing = room.phase === 'playing';

  return (
    <Animated.View style={{ opacity: fade }}>
      {/* One control for the whole card: a button nested inside a button gave
          screen readers two stops for the same action. */}
      <Pressable
        onPress={onOpen}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ busy }}
        accessibilityLabel={
          `${host?.nickname ?? 'Host'}'s table, ${perMinute ? `${rate} coins a minute` : modeName.toLowerCase()}, ` +
          `${playing ? 'game in progress' : 'waiting to start'}, ${seated} of 4 seated. ${cta}.`
        }
        style={({ pressed }) => [cardStyles.card, pressed && cardStyles.pressed]}
      >
        <View style={cardStyles.head}>
          <View style={cardStyles.avatar}>
            <GengalAvatar data={host?.avatarData} size={40} />
          </View>
          <View style={cardStyles.headMeta}>
            <Text style={cardStyles.host} numberOfLines={1}>{host?.nickname ?? 'Host'}</Text>
            <Text style={[cardStyles.headSub, numeric]} numberOfLines={1}>
              {modeName} · {seated} of 4 seated
            </Text>
          </View>
          <View style={[cardStyles.status, playing && cardStyles.statusLive]}>
            {playing && <View style={cardStyles.liveDot} />}
            <Text style={[cardStyles.statusText, playing && cardStyles.statusTextLive]}>
              {playing ? 'PLAYING' : 'OPEN'}
            </Text>
          </View>
        </View>

        {/* Seat strip mirrors the board's clockwise order. */}
        <View style={cardStyles.seats}>
          {SEAT_ORDER.map((color) => {
            const p = room.players.find((pl) => pl.color === color);
            return (
              <View key={color} style={[cardStyles.seat, !p && cardStyles.seatOpen]}>
                <Pawn color={color} size={14} />
                <Text style={[cardStyles.seatName, !p && cardStyles.seatNameOpen]} numberOfLines={1}>
                  {p ? p.nickname : 'Open'}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={cardStyles.foot}>
          <View style={cardStyles.watchers}>
            <MaterialIcons name="visibility" size={14} color="#8B7A6A" />
            <Text style={[cardStyles.watchersText, numeric]}>
              {watching === 0 ? 'Nobody watching' : `${watching} watching`}
            </Text>
          </View>
          <View style={[cardStyles.cta, !amSeated && !open && cardStyles.ctaQuiet, busy && cardStyles.ctaBusy]}>
            {busy ? (
              <ActivityIndicator size="small" color={!amSeated && !open ? skeuo.plum : '#FFFDF8'} />
            ) : (
              <>
                <MaterialIcons
                  name={amSeated || open ? 'login' : 'visibility'}
                  size={15}
                  color={!amSeated && !open ? skeuo.plum : '#FFFDF8'}
                />
                <Text style={[cardStyles.ctaText, !amSeated && !open && cardStyles.ctaTextQuiet]}>{cta}</Text>
              </>
            )}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** One rule line in the open-table sheet. */
function Rule({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <View style={sheetStyles.rule}>
      <MaterialIcons name={icon as any} size={18} color={ludo.inkSoft} style={sheetStyles.ruleIcon} />
      <Text style={[sheetStyles.ruleText, numeric]}>{children}</Text>
    </View>
  );
}

/**
 * Confirms opening a table, with every rule that costs or pays coins spelled
 * out first -- including the ones that can cost the host the deposit.
 */
export function LudoOpenSheet({
  visible, terms, onClose, onConfirm,
}: { visible: boolean; terms: LudoTerms; onClose: () => void; onConfirm: () => void }) {
  const r = terms.rates;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={sheetStyles.root}>
        <Pressable
          style={sheetStyles.scrim}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <View style={sheetStyles.sheet}>
          <View style={sheetStyles.grip} />
          <Text style={sheetStyles.title} accessibilityRole="header">Open a Ludo table</Text>
          <Text style={[sheetStyles.body, numeric]}>
            Opening takes a {terms.deposit}-coin deposit. You play free.
          </Text>

          <View style={sheetStyles.rules}>
            <Rule icon="timer">
              Players pay per minute: {r['3']} each with 3, {r['2']} each with 2, {r['1']} alone. You keep {terms.hostSharePercent}%.
            </Rule>
            <Rule icon="emoji-events">The winner gets a {terms.winnerPrize}-coin bonus.</Rule>
            <Rule icon="logout">
              Stay to the end. You can leave and come back {terms.hostMaxLeaves} times and miss {terms.hostMaxMissed} turns.
              One more and your turns are skipped, and your deposit goes to the players.
            </Rule>
            <Rule icon="group-add">
              If everyone leaves, the board pauses so you can invite friends. It closes after {Math.round(terms.emptyCloseSecs / 60)} minutes empty.
            </Rule>
          </View>

          <Pressable
            onPress={onConfirm}
            accessibilityRole="button"
            accessibilityLabel={`Open the table for a ${terms.deposit} coin deposit`}
            style={({ pressed }) => [sheetStyles.confirm, pressed && sheetStyles.pressed]}
          >
            <MaterialIcons name="add" size={18} color="#FFFDF8" />
            <Text style={[sheetStyles.confirmText, numeric]}>Open table · {terms.deposit} coins</Text>
          </Pressable>
          <Pressable
            onPress={onClose}
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

/** Shared by every bottom sheet in the games lobbies. */
export const sheetStyles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(28,20,24,0.55)' },
  sheet: {
    // Phone-width even on a tablet or the web, matching the screens behind it.
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    backgroundColor: skeuo.surfaceRaised,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 26,
    gap: 10,
  },
  grip: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#DCCBB0', alignSelf: 'center', marginBottom: 6 },
  title: { color: skeuo.plum, fontSize: 20, fontWeight: '900', fontFamily: 'serif' },
  body: { color: '#7E7368', fontSize: 13, fontWeight: '600', lineHeight: 19, marginBottom: 4 },
  pressed: { opacity: 0.75 },
  rules: {
    gap: 10, padding: 14, borderRadius: 16,
    backgroundColor: skeuo.surface, borderWidth: 1, borderColor: skeuo.border,
  },
  rule: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  ruleIcon: { marginTop: 1 },
  ruleText: { flex: 1, color: '#4F463E', fontSize: 13, fontWeight: '600', lineHeight: 19 },
  confirm: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 52, borderRadius: 26, marginTop: 6, backgroundColor: '#1A6B33',
  },
  confirmText: { color: '#FFFDF8', fontSize: 15, fontWeight: '900' },
  cancel: { height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  cancelText: { color: '#7E7368', fontSize: 14, fontWeight: '800' },
});

const cardStyles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 14,
    gap: 12,
    backgroundColor: skeuo.surfaceRaised,
    borderWidth: 1,
    borderColor: skeuo.border,
    boxShadow: Platform.OS === 'web' ? skeuo.raisedShadow : undefined,
    elevation: 2,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 46, height: 46, borderRadius: 23,
    overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
    backgroundColor: skeuo.surfaceInset,
    borderWidth: 1.5, borderColor: ludo.hairline,
  },
  headMeta: { flex: 1, gap: 2 },
  host: { color: skeuo.plum, fontSize: 16, fontWeight: '900' },
  headSub: { color: '#7E7368', fontSize: 12, fontWeight: '700' },
  status: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
    borderWidth: 1, borderColor: skeuo.border, backgroundColor: skeuo.surface,
  },
  statusLive: { borderColor: 'rgba(56,168,28,0.42)', backgroundColor: 'rgba(56,168,28,0.10)' },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: GEMS.green.core },
  statusText: { color: '#7E7368', fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  statusTextLive: { color: GEMS.green.ink },
  seats: { flexDirection: 'row', gap: 6 },
  seat: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 6, paddingVertical: 8, borderRadius: 10,
    backgroundColor: skeuo.surface, borderWidth: 1, borderColor: skeuo.border,
  },
  seatOpen: { borderStyle: 'dashed', borderColor: '#D8C7AC', backgroundColor: 'transparent' },
  seatName: { color: '#4F463E', fontSize: 11, fontWeight: '800', flex: 1 },
  seatNameOpen: { color: '#9C8F82', fontWeight: '700' },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  watchers: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  watchersText: { color: '#7E7368', fontSize: 12, fontWeight: '700' },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, height: 44, borderRadius: 22,
    justifyContent: 'center', minWidth: 128,
    backgroundColor: skeuo.plum,
  },
  // Watching is the lesser action, so it is drawn as one.
  ctaQuiet: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: skeuo.plum },
  ctaBusy: { opacity: 0.7 },
  ctaText: { color: '#FFFDF8', fontSize: 14, fontWeight: '900' },
  ctaTextQuiet: { color: skeuo.plum },
});
