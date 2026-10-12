// The board itself: 930 colored squares, nothing more.
//
// The colored-squares style lives here: one <div> per tile, laid out in a
// CSS grid, background colour looked up from the biome's palette. There is
// deliberately no canvas — plain DOM elements stay trivial to style, debug
// in devtools, and (in later steps) to overlay pieces and traps on.
//
// This component only knows how to *draw* a Tile[] it is handed. It holds
// no state, so it doesn't need "use client" of its own; the page owns the
// seed and regenerates the board when the seed changes.

import { BOARD_WIDTH, NEUTRAL_ROW } from "@/lib/game/constants";
import { BIOME_PALETTES } from "@/lib/game/palettes";
import type { BiomeId, Tile } from "@/lib/game/types";

interface BoardProps {
  tiles: Tile[];
  biome: BiomeId;
}

export default function Board({ tiles, biome }: BoardProps) {
  const palette = BIOME_PALETTES[biome];

  return (
    <div
      className="grid w-full gap-px rounded-lg bg-black/50 p-1"
      style={{
        gridTemplateColumns: `repeat(${BOARD_WIDTH}, minmax(0, 1fr))`,
      }}
      role="img"
      aria-label={`T-rain board in the ${palette.label} biome`}
    >
      {tiles.map((tile, index) => {
        const isNeutralRow = tile.position.y === NEUTRAL_ROW;
        return (
          <div
            // Tiles are stored in index order, so position in the array is
            // a stable, unique key.
            key={index}
            className="aspect-square rounded-[2px]"
            style={{
              backgroundColor: palette.colors[tile.terrain],
              // The neutral row gets an inset outline so the middle of the
              // board reads at a glance, without another colour to learn.
              boxShadow: isNeutralRow
                ? "inset 0 0 0 2px rgba(0, 0, 0, 0.45)"
                : undefined,
            }}
            // Hovering a tile tells you what it is — handy while playtesting
            // generation, harmless in the real game later.
            title={`${palette.terrainLabels[tile.terrain]} (${tile.position.x}, ${tile.position.y})`}
          />
        );
      })}
    </div>
  );
}
