import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { MaterialIcons } from '@expo/vector-icons';
import GengalAvatar from '../GengalAvatar';
import { GEMS, ludo, ludoRadius, numeric } from '../../theme/ludoTheme';
import type { PlayerColor } from '../../screens/LudoConstants';
import type { LudoPlayer } from '../../services/ludoService';

/**
 * One of the four seats around the table.
 *
 * The turn clock is drawn as a depleting ring around the active player's
 * avatar: the room already tracked a turn timeout, but nothing rendered it, so
 * turns expired with no warning.
 */

const AVATAR = 40;
const RING = 48;
const R = (RING - 4) / 2;
const CIRC = 2 * Math.PI * R;

type Props = {
  color: PlayerColor;
  player: LudoPlayer | null;
  isActive: boolean;
  isYou: boolean;
  /** 0..1 of the turn remaining; null hides the ring. */
  turnProgress: number | null;
  secondsLeft: number | null;
  tokensHome: number;
  rank: number | null;
  /** Shown on an empty seat when a seat can be bought. */
  seatPrice: number | null;
  onTakeSeat?: () => void;
  onBet?: () => void;
  betLabel?: string | null;
  align: 'left' | 'right';
};

export function PlayerSeat({
  color, player, isActive, isYou, turnProgress, secondsLeft, tokensHome,
  rank, seatPrice, onTakeSeat, onBet, betLabel, align,
}: Props) {
  const gem = GEMS[color];

  if (!player) {
    return (
      <Pressable
        onPress={onTakeSeat}
        disabled={!onTakeSeat}
        accessibilityRole="button"
        accessibilityLabel={
          seatPrice ? `Take the ${gem.name} seat for ${seatPrice} coins` : `${gem.name} seat is open`
        }
        style={({ pressed }) => [
          styles.seat,
          styles.empty,
          align === 'right' && styles.alignRight,
          pressed && onTakeSeat && styles.pressed,
        ]}
      >
        <View style={[styles.emptyDot, { borderColor: gem.core }]}>
          <MaterialIcons name="add" size={16} color={gem.ink} />
        </View>
        <View style={styles.meta}>
          <Text style={styles.emptyName}>{gem.name}</Text>
          <Text style={[styles.emptySub, numeric]}>
            {seatPrice ? `Open · ${seatPrice} coins` : 'Open seat'}
          </Text>
        </View>
      </Pressable>
    );
  }

  return (
    <View
      style={[
        styles.seat,
        align === 'right' && styles.alignRight,
        { borderColor: isActive ? gem.core : ludo.hairline },
        isActive && styles.seatActive,
      ]}
      accessibilityLabel={
        `${player.nickname}, ${gem.name}${isYou ? ', you' : ''}. ${tokensHome} of 4 home.` +
        (isActive && secondsLeft !== null ? ` Their turn, ${secondsLeft} seconds left.` : '')
      }
    >
      <View style={styles.avatarWrap}>
        {turnProgress !== null && (
          <Svg width={RING} height={RING} style={StyleSheet.absoluteFill}>
            <Circle
              cx={RING / 2} cy={RING / 2} r={R}
              stroke={ludo.hairline} strokeWidth={2.5} fill="none"
            />
            <Circle
              cx={RING / 2} cy={RING / 2} r={R}
              stroke={turnProgress < 0.25 ? ludo.danger : gem.core}
              strokeWidth={2.5}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${CIRC} ${CIRC}`}
              strokeDashoffset={CIRC * (1 - turnProgress)}
              transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
            />
          </Svg>
        )}
        {/* The ring is how you tell who is playing which colour, so it is always
            drawn. It used to appear only on the active player's turn, which
            meant three of the four seats carried no colour at all -- and the
            home pips below stay grey until a token actually finishes, so a
            whole game could pass without the board ever saying who was who.
            Whose turn it is is already carried by the progress ring above. */}
        <View
          style={[
            styles.avatar,
            { borderColor: gem.ink, borderWidth: isActive ? 3 : 1.5 },
          ]}
        >
          <GengalAvatar data={player.avatarData} size={AVATAR} />
        </View>
        {rank !== null && (
          <View style={[styles.rank, { backgroundColor: gem.ink }]}>
            <Text style={[styles.rankText, numeric]}>{rank}</Text>
          </View>
        )}
      </View>

      <View style={styles.meta}>
        <Text style={styles.name} numberOfLines={1}>
          {isYou ? 'You' : player.nickname}
        </Text>
        <View style={styles.pips}>
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              style={[
                styles.pip,
                { backgroundColor: i < tokensHome ? gem.ink : ludo.gridSoft },
              ]}
            />
          ))}
        </View>
        {betLabel && onBet && (
          <Pressable
            onPress={onBet}
            accessibilityRole="button"
            accessibilityLabel={`Back ${player.nickname} to win`}
            // This spends coins, and the seat layout can only afford a ~20pt
            // pill — hitSlop brings the actual touch target up to 44pt so it
            // can't be missed or hit by accident.
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={({ pressed }) => [styles.bet, pressed && styles.pressed]}
          >
            <Text style={[styles.betText, numeric]}>{betLabel}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  seat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 9,
    borderRadius: ludoRadius.seat,
    borderWidth: 1,
    backgroundColor: ludo.card,
    minWidth: 132,
    maxWidth: 168,
  },
  alignRight: { flexDirection: 'row-reverse' },
  seatActive: { backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.16, shadowRadius: 8, elevation: 4 },
  pressed: { opacity: 0.7 },
  empty: { borderStyle: 'dashed', borderColor: ludo.grid, backgroundColor: ludo.cardSunk },
  emptyDot: {
    width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2,
    borderWidth: 1.5, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarWrap: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  avatar: {
    width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2,
    overflow: 'hidden', borderWidth: 1.5,
    backgroundColor: ludo.cardSunk,
  },
  rank: {
    position: 'absolute', bottom: -1, right: -1,
    minWidth: 17, height: 17, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#FFFFFF',
  },
  rankText: { color: '#FFF', fontSize: 9, fontWeight: '900' },
  meta: { flex: 1, gap: 4, minWidth: 0 },
  name: { color: ludo.ink, fontSize: 13, fontWeight: '800' },
  emptyName: { color: ludo.inkSoft, fontSize: 13, fontWeight: '800' },
  emptySub: { color: ludo.inkFaint, fontSize: 10, fontWeight: '700' },
  pips: { flexDirection: 'row', gap: 4 },
  pip: { width: 9, height: 9, borderRadius: 5 },
  bet: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(247, 181, 0, 0.16)',
    borderWidth: 1, borderColor: 'rgba(247, 181, 0, 0.5)',
  },
  betText: { color: '#8A6400', fontSize: 9, fontWeight: '900', letterSpacing: 0.3 },
});
