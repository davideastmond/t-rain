// The board: terrain squares with pieces and traps drawn on top.
//
// The colored-squares style lives here: one <div> per tile in a CSS grid,
// background colour looked up from the biome's palette. Traps are a small
// 💣 in the corner of the tile. Mystery boxes are a 🎁 on their tile
// (public — both players see both boxes), a piece holding a bridge
// wears a 🌉 badge, and a piece with trap sense wears a 🔍 badge.
// There is deliberately no canvas — plain DOM keeps everything
// styleable and clickable per tile.
//
// Pieces live on a separate overlay layer above the grid, one absolutely
// positioned marker per piece, so movement *animates*: each marker is
// keyed by piece id and positioned with a CSS transform, so when a piece
// steps to a new tile React keeps the same DOM node and the transform
// transition glides it there instead of teleporting it. The overlay is
// pointer-events-none, so clicks still land on the tiles underneath.
// `piecesKey` should change whenever a new game starts — remounting the
// markers so they appear in place rather than sliding across the board.
//
// This component only *draws* what it is handed and reports clicks. Which
// pieces/traps it receives is the caller's decision — that is how hidden
// information works: the page simply never passes the opponent's
// untriggered traps in, so they cannot be rendered by accident.
//
// `highlighted` holds tile keys ("x,y") to outline — the page uses it to
// show where the currently selected thing may legally go.

import { tileIndex } from "@/lib/game/board";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CHARACTERS,
  NEUTRAL_ROW,
} from "@/lib/game/constants";
import { BIOME_PALETTES, PLAYER_COLORS } from "@/lib/game/palettes";
import type {
  BiomeId,
  MysteryBox,
  Piece,
  Position,
  Tile,
  Trap,
} from "@/lib/game/types";

export function tileKey(position: Position): string {
  return `${position.x},${position.y}`;
}

interface BoardProps {
  tiles: Tile[];
  biome: BiomeId;
  pieces?: Piece[];
  traps?: Trap[];
  /**
   * Tile keys ("x,y") of traps the viewing player knows about only via
   * trap sense (POWERUPS_SPEC.md §6) — drawn with a "revealed" title so
   * the player can tell them from their own traps. The page decides
   * whose knowledge this is; Board just labels what it is handed.
   */
  revealedTrapKeys?: Set<string>;
  /**
   * Tiles where a piece was nerfed (⚡, top-left corner, tinted in the
   * victim's colour). The engine clears each marker when the victim's
   * next turn ends; Board just draws what it is handed.
   */
  nerfMarkers?: Array<{ position: Position; victim: "north" | "south" }>;
  /**
   * Post-game board: traps in `revealedTrapKeys` are hidden traps
   * revealed only because the game ended, so they get the post-game
   * title instead of the still-live one.
   */
  postGame?: boolean;
  /** Mystery boxes to draw (🎁 on uncollected ones). Boxes are public. */
  mysteryBoxes?: MysteryBox[];
  highlighted?: Set<string>;
  /** Tile keys to outline red — the nerf targeting mode uses this. */
  dangerHighlighted?: Set<string>;
  /** Tile key ("x,y") of the currently selected piece, drawn with a white ring. */
  selectedKey?: string;
  /** Change to remount piece markers (e.g. on a new game) instead of animating them. */
  piecesKey: string | number;
  onTileClick?: (position: Position) => void;
}

export default function Board({
  tiles,
  biome,
  pieces = [],
  traps = [],
  revealedTrapKeys,
  nerfMarkers = [],
  postGame = false,
  mysteryBoxes = [],
  highlighted,
  dangerHighlighted,
  selectedKey,
  piecesKey,
  onTileClick,
}: BoardProps) {
  const palette = BIOME_PALETTES[biome];

  // Index traps by tile so each of the 930 tiles finds its trap in O(1)
  // instead of scanning the array 930 times.
  const trapByTile = new Map<number, Trap>();
  for (const trap of traps) {
    trapByTile.set(tileIndex(trap.position.x, trap.position.y), trap);
  }
  // Same for nerf markers. Two can overlap on one tile in the rare
  // case where a piece re-occupies a marked tile and is itself nerfed
  // before the first marker expires — the newest (last in the array)
  // wins the single ⚡ slot.
  const nerfMarkerByTile = new Map<number, "north" | "south">();
  for (const marker of nerfMarkers) {
    nerfMarkerByTile.set(
      tileIndex(marker.position.x, marker.position.y),
      marker.victim,
    );
  }
  // Same for uncollected mystery boxes — collected ones disappear.
  const boxByTile = new Map<number, MysteryBox>();
  for (const box of mysteryBoxes) {
    if (!box.collected) {
      boxByTile.set(tileIndex(box.position.x, box.position.y), box);
    }
  }
  const activePieces = pieces.filter((piece) => piece.status === "active");

  return (
    // The board keeps a minimum tile size (~24px) instead of shrinking
    // to fit narrow screens: below that width the wrapper scrolls
    // sideways. On desktop the page column (~1024px) is wider than the
    // minimum, so nothing changes there — the board still fills it.
    <div className="w-full overflow-x-auto">
      <div className="relative min-w-[760px]">
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
          const isHighlighted =
            highlighted?.has(tileKey(tile.position)) ?? false;
          const isDangerHighlighted =
            dangerHighlighted?.has(tileKey(tile.position)) ?? false;
          const trap = trapByTile.get(index);
          const nerfVictim = nerfMarkerByTile.get(index);
          const box = boxByTile.get(index);

          return (
            <div
              key={index}
              onClick={
                onTileClick ? () => onTileClick(tile.position) : undefined
              }
              className={`relative aspect-square rounded-[2px] ${
                onTileClick ? "cursor-pointer" : ""
              }`}
              style={{
                backgroundColor: palette.colors[tile.terrain],
                boxShadow: isDangerHighlighted
                  ? "inset 0 0 0 2px rgba(239, 68, 68, 0.9)"
                  : isHighlighted
                    ? "inset 0 0 0 2px rgba(255, 255, 255, 0.85)"
                    : isNeutralRow
                      ? "inset 0 0 0 2px rgba(0, 0, 0, 0.45)"
                      : undefined,
              }}
              title={`${palette.terrainLabels[tile.terrain]} (${tile.position.x}, ${tile.position.y})`}
            >
              {trap && (
                <span
                  className="absolute right-0 bottom-0 text-[16px] leading-none"
                  title={
                    trap.triggered
                      ? "Triggered trap"
                      : revealedTrapKeys?.has(tileKey(trap.position))
                        ? postGame
                          ? "Hidden trap — revealed after the game"
                          : "Revealed trap — still live!"
                        : "Trap"
                  }
                >
                  {trap.triggered ? "💥" : "💣"}
                </span>
              )}
              {nerfVictim && (
                <span
                  className="absolute top-0 left-0 text-[14px] leading-none"
                  style={{ color: PLAYER_COLORS[nerfVictim] }}
                  title={`Piece nerfed here — clears when ${nerfVictim === "north" ? "North" : "South"}'s turn ends`}
                >
                  ⚡
                </span>
              )}
              {box && (
                <span
                  className="absolute bottom-0 left-0 text-[16px] leading-none"
                  title="Mystery box — only the invader can collect it"
                >
                  🎁
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Piece overlay: same box as the grid's tiles (inset-0 p-1 mirrors
          the grid's p-1), so percentage positioning lines up with tiles.
          translate() percentages refer to the marker's own size — one tile —
          so translate(x*100%, y*100%) lands exactly on tile (x, y). */}
      <div
        className="pointer-events-none absolute inset-0 p-1"
        aria-hidden="true"
      >
        {activePieces.map((piece) => (
          <div
            key={`${piecesKey}:${piece.id}`}
            className="absolute top-0 left-0"
            style={{
              width: `${100 / BOARD_WIDTH}%`,
              height: `${100 / BOARD_HEIGHT}%`,
              transform: `translate(${piece.position.x * 100}%, ${piece.position.y * 100}%)`,
              transition: "transform 200ms ease-out",
              willChange: "transform",
            }}
          >
            <span
              className={`absolute inset-[4%] flex items-center justify-center rounded-full text-[20px] leading-none ${
                selectedKey === tileKey(piece.position)
                  ? "ring-4 ring-white"
                  : "ring-1 ring-black/60"
              }`}
              style={{ backgroundColor: PLAYER_COLORS[piece.owner] }}
              title={`${piece.owner === "north" ? "North" : "South"} ${CHARACTERS[piece.character].label}`}
            >
              {CHARACTERS[piece.character].emoji}
              {piece.hasBridge && (
                <span
                  className="absolute -top-1.5 -right-1.5 text-[11px] leading-none"
                  title="Holds a bridge — can cross one water tile"
                >
                  🌉
                </span>
              )}
              {piece.hasTrapSense && (
                <span
                  className="absolute -top-1.5 -left-1.5 text-[11px] leading-none"
                  title="Has trap sense this turn — the traps next to it are revealed to its owner"
                >
                  🔍
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
