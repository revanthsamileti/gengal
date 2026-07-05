export type PlayerColor = 'red' | 'green' | 'yellow' | 'blue';

export const PLAYERS: PlayerColor[] = ['red', 'green', 'yellow', 'blue'];

export const PLAYER_NAMES: Record<PlayerColor, string> = {
  red: 'Ruby',
  green: 'Emerald',
  yellow: 'Gold',
  blue: 'Sapphire',
};

export type Cell = { x: number; y: number };

export const PATH: Cell[] = [
  { x: 1, y: 6 }, { x: 2, y: 6 }, { x: 3, y: 6 }, { x: 4, y: 6 }, { x: 5, y: 6 },
  { x: 6, y: 5 }, { x: 6, y: 4 }, { x: 6, y: 3 }, { x: 6, y: 2 }, { x: 6, y: 1 },
  { x: 6, y: 0 }, { x: 7, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 1 }, { x: 8, y: 2 },
  { x: 8, y: 3 }, { x: 8, y: 4 }, { x: 8, y: 5 }, { x: 9, y: 6 }, { x: 10, y: 6 },
  { x: 11, y: 6 }, { x: 12, y: 6 }, { x: 13, y: 6 }, { x: 14, y: 6 }, { x: 14, y: 7 },
  { x: 14, y: 8 }, { x: 13, y: 8 }, { x: 12, y: 8 }, { x: 11, y: 8 }, { x: 10, y: 8 },
  { x: 9, y: 8 }, { x: 8, y: 9 }, { x: 8, y: 10 }, { x: 8, y: 11 }, { x: 8, y: 12 },
  { x: 8, y: 13 }, { x: 8, y: 14 }, { x: 7, y: 14 }, { x: 6, y: 14 }, { x: 6, y: 13 },
  { x: 6, y: 12 }, { x: 6, y: 11 }, { x: 6, y: 10 }, { x: 6, y: 9 }, { x: 5, y: 8 },
  { x: 4, y: 8 }, { x: 3, y: 8 }, { x: 2, y: 8 }, { x: 1, y: 8 }, { x: 0, y: 8 },
  { x: 0, y: 7 }, { x: 0, y: 6 },
];

export const START_INDEX: Record<PlayerColor, number> = {
  red: 0, green: 13, yellow: 26, blue: 39,
};

export const SAFE_CELLS = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
export const STAR_CELLS = new Set([8, 21, 34, 47]);

export const HOME_COLUMN: Record<PlayerColor, Cell[]> = {
  red: [ { x: 1, y: 7 }, { x: 2, y: 7 }, { x: 3, y: 7 }, { x: 4, y: 7 }, { x: 5, y: 7 } ],
  green: [ { x: 7, y: 1 }, { x: 7, y: 2 }, { x: 7, y: 3 }, { x: 7, y: 4 }, { x: 7, y: 5 } ],
  yellow: [ { x: 13, y: 7 }, { x: 12, y: 7 }, { x: 11, y: 7 }, { x: 10, y: 7 }, { x: 9, y: 7 } ],
  blue: [ { x: 7, y: 13 }, { x: 7, y: 12 }, { x: 7, y: 11 }, { x: 7, y: 10 }, { x: 7, y: 9 } ],
};

export const BASE_ORIGIN: Record<PlayerColor, Cell> = {
  red: { x: 0, y: 0 }, green: { x: 9, y: 0 }, yellow: { x: 9, y: 9 }, blue: { x: 0, y: 9 },
};

export const BASE_PADS: Cell[] = [
  { x: 1.6, y: 1.6 }, { x: 3.4, y: 1.6 }, { x: 1.6, y: 3.4 }, { x: 3.4, y: 3.4 },
];

export const HOME_REST: Record<PlayerColor, Cell> = {
  red: { x: 5.9, y: 7 }, green: { x: 7, y: 5.9 }, yellow: { x: 8.1, y: 7 }, blue: { x: 7, y: 8.1 },
};

export const HOME_PROGRESS = 56;

export function cellForProgress(color: PlayerColor, progress: number, tokenIndex: number): Cell {
  if (progress < 0) {
    const origin = BASE_ORIGIN[color];
    const pad = BASE_PADS[tokenIndex];
    return { x: origin.x + pad.x, y: origin.y + pad.y };
  }
  if (progress <= 50) {
    return PATH[(START_INDEX[color] + progress) % 52];
  }
  if (progress <= 55) {
    return HOME_COLUMN[color][progress - 51];
  }
  return HOME_REST[color];
}
