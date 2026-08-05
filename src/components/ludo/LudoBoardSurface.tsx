import React, { memo } from 'react';
import Svg, {
  Circle, Defs, G, LinearGradient, Path as SvgPath, Polygon, Rect, Stop,
} from 'react-native-svg';
import {
  BASE_ORIGIN, BASE_PADS, GRID, HOME_COLUMN, PATH, PLAYERS, START_INDEX, STAR_CELLS,
  PlayerColor,
} from '../../screens/LudoConstants';
import { GEMS, ludo } from '../../theme/ludoTheme';

/**
 * The classic board, drawn once as a single SVG. Pawns are animated views
 * layered on top, so nothing here re-renders during play.
 *
 * Everything is laid out in a 0..15 grid and scaled by the viewBox, so cells
 * stay crisp at any board size.
 */

const STAR = 'M0,-0.34 L0.10,-0.105 L0.34,-0.082 L0.16,0.068 L0.21,0.32 L0,0.188 L-0.21,0.32 L-0.16,0.068 L-0.34,-0.082 L-0.10,-0.105 Z';

/** Which edge cell carries each colour's way-in arrow, and which way it points. */
const ENTRY_ARROWS: { color: PlayerColor; x: number; y: number; rotate: number }[] = [
  { color: 'green', x: 7, y: 0, rotate: 90 },   // top, pointing down
  { color: 'yellow', x: 14, y: 7, rotate: 180 }, // right, pointing left
  { color: 'red', x: 7, y: 14, rotate: 270 },   // bottom, pointing up
  { color: 'blue', x: 0, y: 7, rotate: 0 },     // left, pointing right
];

function LudoBoardSurfaceImpl({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${GRID} ${GRID}`}>
      <Defs>
        {PLAYERS.map((p) => (
          <LinearGradient key={`bg-${p}`} id={`base-${p}`} x1="0" y1="0" x2="0.4" y2="1">
            <Stop offset="0" stopColor={GEMS[p].core} />
            <Stop offset="1" stopColor={GEMS[p].dark} stopOpacity="0.92" />
          </LinearGradient>
        ))}
      </Defs>

      {/* Track ground */}
      <Rect x="0" y="0" width={GRID} height={GRID} fill={ludo.board} />

      {/* Colour bases: a solid block with a white tray for the four pawns */}
      {PLAYERS.map((p) => {
        const o = BASE_ORIGIN[p];
        return (
          <G key={`base-${p}`}>
            <Rect x={o.x} y={o.y} width={6} height={6} fill={`url(#base-${p})`} />
            <Rect
              x={o.x + 0.75} y={o.y + 0.75} width={4.5} height={4.5}
              rx={0.75} fill="#FFFFFF"
            />
            <Rect
              x={o.x + 0.75} y={o.y + 0.75} width={4.5} height={4.5}
              rx={0.75} fill="none" stroke={GEMS[p].dark} strokeWidth={0.05} strokeOpacity={0.25}
            />
            {/* Faint seats so an empty base still reads as four places */}
            {BASE_PADS.map((pad, i) => (
              <Circle
                key={i} cx={o.x + pad.x} cy={o.y + pad.y} r={0.66}
                fill={GEMS[p].core} fillOpacity={0.13}
              />
            ))}
          </G>
        );
      })}

      {/* Shared track */}
      {PATH.map((cell, i) => {
        const owner = PLAYERS.find((p) => START_INDEX[p] === i);
        const isStar = STAR_CELLS.has(i);
        return (
          <G key={`t-${i}`}>
            <Rect
              x={cell.x} y={cell.y} width={1} height={1}
              fill={owner ? GEMS[owner].core : ludo.cell}
              stroke={ludo.grid} strokeWidth={0.055}
            />
            {(owner || isStar) && (
              <SvgPath
                d={STAR}
                transform={`translate(${cell.x + 0.5}, ${cell.y + 0.5}) scale(1.45)`}
                fill={owner ? ludo.starOnColor : ludo.star}
              />
            )}
          </G>
        );
      })}

      {/* Run-in columns */}
      {PLAYERS.map((p) =>
        HOME_COLUMN[p].map((cell, i) => (
          <Rect
            key={`h-${p}-${i}`}
            x={cell.x} y={cell.y} width={1} height={1}
            fill={GEMS[p].core} stroke={ludo.grid} strokeWidth={0.055}
          />
        ))
      )}

      {/* Way-in arrows on each arm's outer edge */}
      {ENTRY_ARROWS.map(({ color, x, y, rotate }) => (
        <SvgPath
          key={`arrow-${color}`}
          d="M-0.16,-0.22 L0.18,0 L-0.16,0.22"
          fill="none"
          stroke={GEMS[color].core}
          strokeWidth={0.16}
          strokeLinecap="round"
          strokeLinejoin="round"
          transform={`translate(${x + 0.5}, ${y + 0.5}) rotate(${rotate})`}
        />
      ))}

      {/* Centre: four triangles meeting at the finish */}
      <G>
        <Polygon points="6,6 9,6 7.5,7.5" fill={GEMS.green.core} />
        <Polygon points="9,6 9,9 7.5,7.5" fill={GEMS.yellow.core} />
        <Polygon points="6,9 9,9 7.5,7.5" fill={GEMS.red.core} />
        <Polygon points="6,6 6,9 7.5,7.5" fill={GEMS.blue.core} />
        <Rect
          x={6} y={6} width={3} height={3}
          fill="none" stroke={ludo.grid} strokeWidth={0.055}
        />
      </G>
    </Svg>
  );
}

export const LudoBoardSurface = memo(LudoBoardSurfaceImpl);
