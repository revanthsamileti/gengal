/**
 * Board geometry for the Ludo table.
 *
 * IMPORTANT — this module renders whatever `ludoService` stores, so its
 * encoding must match the engine exactly:
 *
 *   -1        token is in its base
 *   0..51     ABSOLUTE index on the shared 52-cell track (not per-player progress)
 *   52..56    the player's own home column, nearest-to-furthest
 *   58        finished, resting in the centre
 *
 * The previous version treated 0..51 as per-player progress and re-added the
 * colour's entry offset, used a different clockwise colour order than the
 * engine, and indexed the home column one cell late — so tokens drew in the
 * wrong squares. Entry offsets below are the engine's COLOR_ENTRY values.
 */

export type PlayerColor = 'red' | 'blue' | 'green' | 'yellow';

/** Clockwise from the top-left quadrant, matching the engine's turn order. */
export const PLAYERS: PlayerColor[] = ['red', 'blue', 'green', 'yellow'];

/** Gemstone names — the board renders each colour as its cut stone. */
export const PLAYER_NAMES: Record<PlayerColor, string> = {
  red: 'Ruby',
  blue: 'Sapphire',
  green: 'Emerald',
  yellow: 'Topaz',
};

export type Cell = { x: number; y: number };

/**
 * The 52 shared track cells, clockwise, starting at red's entry.
 *
 * Laid out to the familiar arrangement: blue top-left, green top-right,
 * yellow bottom-right, red bottom-left. Because the engine fixes which entry
 * index each colour owns, the board is drawn rotated a quarter turn from the
 * raw index order — a rendering choice only, invisible to the engine.
 */
export const PATH: Cell[] = [
  { x: 6, y: 13 }, { x: 6, y: 12 }, { x: 6, y: 11 }, { x: 6, y: 10 }, { x: 6, y: 9 },
  { x: 5, y: 8 }, { x: 4, y: 8 }, { x: 3, y: 8 }, { x: 2, y: 8 }, { x: 1, y: 8 },
  { x: 0, y: 8 }, { x: 0, y: 7 }, { x: 0, y: 6 }, { x: 1, y: 6 }, { x: 2, y: 6 },
  { x: 3, y: 6 }, { x: 4, y: 6 }, { x: 5, y: 6 }, { x: 6, y: 5 }, { x: 6, y: 4 },
  { x: 6, y: 3 }, { x: 6, y: 2 }, { x: 6, y: 1 }, { x: 6, y: 0 }, { x: 7, y: 0 },
  { x: 8, y: 0 }, { x: 8, y: 1 }, { x: 8, y: 2 }, { x: 8, y: 3 }, { x: 8, y: 4 },
  { x: 8, y: 5 }, { x: 9, y: 6 }, { x: 10, y: 6 }, { x: 11, y: 6 }, { x: 12, y: 6 },
  { x: 13, y: 6 }, { x: 14, y: 6 }, { x: 14, y: 7 }, { x: 14, y: 8 }, { x: 13, y: 8 },
  { x: 12, y: 8 }, { x: 11, y: 8 }, { x: 10, y: 8 }, { x: 9, y: 8 }, { x: 8, y: 9 },
  { x: 8, y: 10 }, { x: 8, y: 11 }, { x: 8, y: 12 }, { x: 8, y: 13 }, { x: 8, y: 14 },
  { x: 7, y: 14 }, { x: 6, y: 14 },
];

/** Mirrors COLOR_ENTRY in ludoService — the cell each colour starts on. */
export const START_INDEX: Record<PlayerColor, number> = {
  red: 0, blue: 13, green: 26, yellow: 39,
};

/** Entry cells plus the four stars. A token here cannot be captured. */
export const SAFE_CELLS = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
export const STAR_CELLS = new Set([8, 21, 34, 47]);

/**
 * Each colour's run-in, ordered from the track inwards: blue runs in along the
 * left arm, green down the top, yellow along the right, red up the bottom.
 */
export const HOME_COLUMN: Record<PlayerColor, Cell[]> = {
  red: [{ x: 7, y: 13 }, { x: 7, y: 12 }, { x: 7, y: 11 }, { x: 7, y: 10 }, { x: 7, y: 9 }],
  blue: [{ x: 1, y: 7 }, { x: 2, y: 7 }, { x: 3, y: 7 }, { x: 4, y: 7 }, { x: 5, y: 7 }],
  green: [{ x: 7, y: 1 }, { x: 7, y: 2 }, { x: 7, y: 3 }, { x: 7, y: 4 }, { x: 7, y: 5 }],
  yellow: [{ x: 13, y: 7 }, { x: 12, y: 7 }, { x: 11, y: 7 }, { x: 10, y: 7 }, { x: 9, y: 7 }],
};

/** Top-left corner of each 6x6 base block. */
export const BASE_ORIGIN: Record<PlayerColor, Cell> = {
  blue: { x: 0, y: 0 }, green: { x: 9, y: 0 }, yellow: { x: 9, y: 9 }, red: { x: 0, y: 9 },
};

/** Centres of the four resting pads inside a base, relative to its origin. */
export const BASE_PADS: Cell[] = [
  { x: 1.5, y: 1.5 }, { x: 3.5, y: 1.5 }, { x: 1.5, y: 3.5 }, { x: 3.5, y: 3.5 },
];

/** Centre of each colour's wedge in the middle, where finished pawns rest. */
export const HOME_REST: Record<PlayerColor, Cell> = {
  green: { x: 7.5, y: 6.85 }, yellow: { x: 8.15, y: 7.5 },
  red: { x: 7.5, y: 8.15 }, blue: { x: 6.85, y: 7.5 },
};

// Engine position sentinels, re-exported so the renderer reads in one vocabulary.
export const BASE_POSITION = -1;
export const HOME_COLUMN_START = 52;
export const HOME_COLUMN_CELLS = 5;
export const FINISHED_POSITION = 58;

export const GRID = 15;

/**
 * Where a pawn stands, as the CENTRE of its square in grid units.
 *
 * Every branch must return a centre. PATH and HOME_COLUMN store top-left
 * corners, so they get the half-cell added here; base pads and the centre rest
 * are already centres. Mixing the two conventions is what put every pawn in a
 * base half a square off its pad.
 */
export function cellForPosition(color: PlayerColor, position: number, tokenIndex: number): Cell {
  if (position === BASE_POSITION) {
    const origin = BASE_ORIGIN[color];
    const pad = BASE_PADS[tokenIndex] ?? BASE_PADS[0];
    return { x: origin.x + pad.x, y: origin.y + pad.y };
  }
  if (position >= 0 && position < PATH.length) {
    return { x: PATH[position].x + 0.5, y: PATH[position].y + 0.5 };
  }
  if (position >= HOME_COLUMN_START && position < HOME_COLUMN_START + HOME_COLUMN_CELLS) {
    const cell = HOME_COLUMN[color][position - HOME_COLUMN_START];
    return { x: cell.x + 0.5, y: cell.y + 0.5 };
  }
  return HOME_REST[color];
}

/**
 * The cells a token visits between two positions, so a move can be animated as
 * a series of hops rather than a teleport. Includes the destination, excludes
 * the origin.
 */
export function pathBetween(color: PlayerColor, from: number, to: number): number[] {
  // Leaving base, or arriving home: a single hop.
  if (from === BASE_POSITION || to === FINISHED_POSITION) return [to];

  const steps: number[] = [];
  const entry = START_INDEX[color];
  // The last shared-track cell before this colour turns into its home column.
  const lastTrackCell = (entry + 51) % 52;
  const lastHomeCell = HOME_COLUMN_START + HOME_COLUMN_CELLS - 1;

  let cursor = from;
  // A full lap plus the run-in is 57 squares; anything longer means the two
  // positions do not connect, so fall back to a single hop rather than
  // emitting a runaway list.
  for (let guard = 0; guard < 58 && cursor !== to; guard++) {
    if (cursor >= HOME_COLUMN_START) {
      if (cursor >= lastHomeCell) break;
      cursor += 1;
    } else if (cursor === lastTrackCell) {
      cursor = HOME_COLUMN_START;
    } else {
      cursor = (cursor + 1) % 52;
    }
    steps.push(cursor);
  }

  return cursor === to && steps.length > 0 ? steps : [to];
}
