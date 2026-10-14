// Every tunable number in T-rain, in one file.
//
// If playtesting says the game is too slow, too deadly, or too long, the fix
// should be changing a value here — not hunting through engine code. Each
// constant says which rule from SPEC.md it comes from.

import type { CharacterId, PlayerId } from "./types";

// --- Board geometry ---------------------------------------------------------

/** Tiles across. Columns are x = 0 to BOARD_WIDTH - 1. */
export const BOARD_WIDTH = 30;

/** Tiles down. Rows are y = 0 to BOARD_HEIGHT - 1. */
export const BOARD_HEIGHT = 31;

/** Height of each player's home zone, in rows. North: y 0-14, South: y 16-30. */
export const PLAYER_ZONE_HEIGHT = 15;

/** The single neutral row between the two zones. Every crossing passes through it. */
export const NEUTRAL_ROW = 15;

/** How many of a player's back rows their pieces may be placed in during setup. */
export const SETUP_ROWS = 3;

/** The row a player must reach to score: North scores on South's back row, and vice versa. */
export const GOAL_ROW: Record<PlayerId, number> = {
  north: BOARD_HEIGHT - 1, // 30
  south: 0,
};

// --- Setup ------------------------------------------------------------------

/** Seconds both players get to place all of their pieces and traps. */
export const SETUP_TIME_SECONDS = 120;

/** Traps each player places during setup. */
export const TRAPS_PER_PLAYER = 10;

/** Of those traps, at most this many may go in the neutral row. */
export const MAX_NEUTRAL_TRAPS = 3;

// --- Pieces and winning -----------------------------------------------------

/** Pieces each player starts with — one per character in CHARACTERS below. */
export const PIECES_PER_PLAYER = 15;

/** First player to get this many pieces across wins. */
export const PIECES_TO_WIN = 5;

// --- Movement ---------------------------------------------------------------

/** Movement points in the shared pool each turn, split across any pieces. */
export const MOVEMENT_POINTS_PER_TURN = 10;

/** Most movement points that may be spent on a single piece in one turn. */
export const MAX_POINTS_PER_PIECE_PER_TURN = 3;

// --- Terrain generation -----------------------------------------------------

/** Approximate share of tiles generated as forest. The rest (after water) is plains. */
export const FOREST_PERCENT = 15;

/** Approximate share of tiles generated as water. */
export const WATER_PERCENT = 10;

/**
 * A generated board is only accepted if a crossing flood fill (see board.ts)
 * reaches at least this many tiles on the far back row. Boards that fail are
 * re-rolled, so water can never seal the board or leave it a single doorway.
 */
export const MIN_CROSSING_ENTRIES = 3;

// --- Characters -------------------------------------------------------------

/**
 * Display data for each character: the name players see and the emoji drawn
 * on its team-coloured marker. This is the *only* thing that distinguishes
 * one piece from another — there are deliberately no stats here, because no
 * character has any gameplay difference from any other.
 */
export const CHARACTERS: Record<CharacterId, { label: string; emoji: string }> = {
  cat: { label: "Cat", emoji: "🐱" },
  dog: { label: "Dog", emoji: "🐶" },
  horse: { label: "Horse", emoji: "🐴" },
  mouse: { label: "Mouse", emoji: "🐭" },
  spider: { label: "Spider", emoji: "🕷️" },
  elephant: { label: "Elephant", emoji: "🐘" },
  soldier: { label: "Soldier", emoji: "💂" },
  alien: { label: "Alien", emoji: "👽" },
  fox: { label: "Fox", emoji: "🦊" },
  bear: { label: "Bear", emoji: "🐻" },
  rabbit: { label: "Rabbit", emoji: "🐰" },
  frog: { label: "Frog", emoji: "🐸" },
  pig: { label: "Pig", emoji: "🐷" },
  owl: { label: "Owl", emoji: "🦉" },
  penguin: { label: "Penguin", emoji: "🐧" },
};
