import type { TextStyle } from 'react-native';

/**
 * Shared tokens for every live room — expert stages, party games, board games.
 *
 * Two tones, one component set. A Ludo board is a bright physical object and
 * reads best on white; a live audio stage reads best dark, so avatars and the
 * speaking indicator carry the eye. Both are the same product, so the type
 * scale, spacing and radii are identical and only the palette swaps.
 */

export type RoomTone = 'dark' | 'light';

export type RoomPalette = {
  /** Page background. */
  bg: string;
  /** Raised surfaces: seats, dock, sheets. */
  card: string;
  /** Recessed surfaces: inputs, empty slots. */
  cardSunk: string;
  /** Hairline borders. */
  line: string;
  /** Border on an emphasised element. */
  lineStrong: string;
  /** Primary text. */
  ink: string;
  /** Secondary text. */
  inkSoft: string;
  /** Tertiary text, timestamps, hints. */
  inkFaint: string;
  /** Brand accent — the colour of money and emphasis. */
  accent: string;
  /** Text that sits on the accent. */
  onAccent: string;
  /** Live / speaking. */
  live: string;
  /** Destructive or over-budget. */
  danger: string;
};

const DARK: RoomPalette = {
  bg: '#0D0410',
  card: 'rgba(255, 253, 248, 0.06)',
  cardSunk: 'rgba(0, 0, 0, 0.34)',
  line: 'rgba(201, 168, 76, 0.22)',
  lineStrong: 'rgba(201, 168, 76, 0.55)',
  ink: '#FAF7F2',
  inkSoft: 'rgba(250, 247, 242, 0.72)',
  inkFaint: 'rgba(250, 247, 242, 0.42)',
  accent: '#C9A84C',
  onAccent: '#1B0A1E',
  live: '#39BE69',
  danger: '#E5484D',
};

const LIGHT: RoomPalette = {
  bg: '#F4F1EC',
  card: '#FFFFFF',
  cardSunk: '#F7F5F1',
  line: '#E2DDD5',
  lineStrong: '#C9BFB1',
  ink: '#1F1B18',
  inkSoft: '#6B635C',
  inkFaint: '#9C948C',
  accent: '#B07C00',
  onAccent: '#FFFFFF',
  live: '#38A81C',
  danger: '#E32B22',
};

export const roomPalette = (tone: RoomTone): RoomPalette => (tone === 'dark' ? DARK : LIGHT);

/** Numerals that change in place must not reflow as they count. */
export const numeric: TextStyle = { fontVariant: ['tabular-nums'] };

export const roomRadius = { seat: 16, dock: 20, sheet: 24, chip: 12, pill: 999 } as const;

export const roomSpace = { xs: 4, sm: 8, md: 12, lg: 16, xl: 22 } as const;

/**
 * Vertical budget for a room screen. Every room lays out header → stage →
 * dock → rail, and the stage takes what is left rather than pushing the
 * controls off a short device.
 */
export const ROOM_CHROME = {
  header: 56,
  dock: 92,
  rail: 58,
  gaps: 24,
} as const;

export const roomChromeHeight = () =>
  ROOM_CHROME.header + ROOM_CHROME.dock + ROOM_CHROME.rail + ROOM_CHROME.gaps;
