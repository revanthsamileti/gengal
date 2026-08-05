/**
 * Ludo table design tokens — the classic board.
 *
 * White track, thin grey grid, four saturated primaries, glossy pawns. This is
 * the arrangement players already know from every physical Ludo set, so the
 * board needs no learning: colour identifies the player, the star marks safety,
 * the arrow marks the way in.
 *
 * The surrounding app chrome stays light so the board reads as the bright thing
 * on the screen.
 */

import type { TextStyle } from 'react-native';

export type GemColor = 'red' | 'blue' | 'green' | 'yellow';

export const ludo = {
  // Board
  board: '#FFFFFF',
  cell: '#FFFFFF',
  grid: '#BFBFBF',
  gridSoft: '#DCDCDC',
  frame: '#1C1C1C',
  frameLift: '#3A3A3A',
  star: '#9E9E9E',
  starOnColor: '#FFFFFF',

  // Screen chrome
  surface: '#F4F1EC',
  card: '#FFFFFF',
  cardSunk: '#F7F5F1',
  hairline: '#E2DDD5',
  ink: '#1F1B18',
  inkSoft: '#6B635C',
  inkFaint: '#9C948C',
  accent: '#F7B500',
  danger: '#E32B22',
} as const;

type PieceSpec = {
  /** Body of the pawn and the colour's cells. */
  core: string;
  /** Gloss highlight. */
  light: string;
  /** Outline and shading. */
  dark: string;
  /** Tint behind a colour's own area. */
  wash: string;
  name: string;
};

export const GEMS: Record<GemColor, PieceSpec> = {
  blue: {
    core: '#1B76E3', light: '#7DB6F2', dark: '#0D4C95',
    wash: 'rgba(27, 118, 227, 0.12)', name: 'Blue',
  },
  green: {
    core: '#38A81C', light: '#83D26A', dark: '#1E6B0E',
    wash: 'rgba(56, 168, 28, 0.12)', name: 'Green',
  },
  red: {
    core: '#E32B22', light: '#F58079', dark: '#9C130D',
    wash: 'rgba(227, 43, 34, 0.12)', name: 'Red',
  },
  yellow: {
    core: '#F7B500', light: '#FFD968', dark: '#B07C00',
    wash: 'rgba(247, 181, 0, 0.14)', name: 'Yellow',
  },
};

/**
 * Numerals that change in place — timers, dice values, coin balances — use
 * tabular figures so they do not jitter as they count.
 */
export const numeric: TextStyle = { fontVariant: ['tabular-nums'] };

export const ludoType = {
  /** Small label above a value. Never a sentence. */
  eyebrow: {
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
    color: ludo.inkFaint,
  },
  display: {
    fontWeight: '900' as const,
    color: ludo.ink,
  },
  body: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: ludo.inkSoft,
  },
};

export const ludoRadius = { seat: 14, dock: 18, sheet: 22, board: 18 } as const;
