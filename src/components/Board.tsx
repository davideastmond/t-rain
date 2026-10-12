// The board: terrain squares with pieces and traps drawn on top.
//
// The colored-squares style lives here: one <div> per tile in a CSS grid,
// background colour looked up from the biome's palette. Pieces are round
// team-coloured markers with the character's emoji; traps are a small 💣
// in the corner of the tile. There is deliberately no canvas — plain DOM
// keeps everything styleable and clickable per tile.
//
// This component only *draws* what it is handed and reports clicks. Which
// pieces/traps it receives is the caller's decision — that is how hidden
// information works: the page simply never passes the opponent's
// untriggered traps in, so they cannot be rendered by accident.
//
// `highlighted` holds tile keys ("x,y") to outline — the page uses it to
// show where the currently selected thing may legally go.

import { tileIndex } from "@/lib/game/board";
import { BOARD_WIDTH, CHARACTERS, NEUTRAL_ROW } from "@/lib/game/constants";
import { BIOME_PALETTES, PLAYER_COLORS } from "@/lib/game/palettes";
import type { BiomeId, Piece, Position, Tile, Trap } from "@/lib/game/types";

export function tileKey(position: Position): string {
  return `${position.x},${position.y}`;
}

interface BoardProps {
  tiles: Tile[];
  biome: BiomeId;
  pieces?: Piece[];
  traps?: Trap[];
  highlighted?: Set<string>;
  onTileClick?: (position: Position) => void;
}

export default function Board({
  tiles,
  biome,
  pieces = [],
  traps = [],
  highlighted,
  onTileClick,
}: BoardProps) {
  const palette = BIOME_PALETTES[biome];

  // Index overlays by tile so each of the 930 tiles finds its piece/trap in
  // O(1) instead of scanning the arrays 930 times.
  const pieceByTile = new Map<number, Piece>();
  for (const piece of pieces) {
    if (piece.status === "active") {
      pieceByTile.set(tileIndex(piece.position.x, piece.position.y), piece);
    }
  }
  const trapByTile = new Map<number, Trap>();
  for (const trap of traps) {
    trapByTile.set(tileIndex(trap.position.x, trap.position.y), trap);
  }

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
        const isHighlighted = highlighted?.has(tileKey(tile.position)) ?? false;
        const piece = pieceByTile.get(index);
        const trap = trapByTile.get(index);

        return (
          <div
            key={index}
            onClick={onTileClick ? () => onTileClick(tile.position) : undefined}
            className={`relative aspect-square rounded-[2px] ${
              onTileClick ? "cursor-pointer" : ""
            }`}
            style={{
              backgroundColor: palette.colors[tile.terrain],
              boxShadow: isHighlighted
                ? "inset 0 0 0 2px rgba(255, 255, 255, 0.85)"
                : isNeutralRow
                  ? "inset 0 0 0 2px rgba(0, 0, 0, 0.45)"
                  : undefined,
            }}
            title={`${palette.terrainLabels[tile.terrain]} (${tile.position.x}, ${tile.position.y})`}
          >
            {piece && (
              <span
                className="absolute inset-[4%] flex items-center justify-center rounded-full text-[20px] leading-none ring-1 ring-black/60"
                style={{ backgroundColor: PLAYER_COLORS[piece.owner] }}
                title={`${piece.owner === "north" ? "North" : "South"} ${CHARACTERS[piece.character].label}`}
              >
                {CHARACTERS[piece.character].emoji}
              </span>
            )}
            {trap && (
              <span
                className="absolute right-0 bottom-0 text-[16px] leading-none"
                title={trap.triggered ? "Triggered trap" : "Trap"}
              >
                {trap.triggered ? "💥" : "💣"}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
