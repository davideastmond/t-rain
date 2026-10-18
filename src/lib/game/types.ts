// Core data model for T-rain.
//
// Everything in this file is a *description* of the game — no behaviour.
// The engine (board generation, movement, traps) will be functions in other
// files that read and transform these types. Keeping the data model pure is
// what lets the same types be used by the UI, a future CPU opponent, and a
// future server without changes.
//
// See SPEC.md for the rules these types encode.

/** The two competitors. North starts at the top of the board, South at the bottom. */
export type PlayerId = "north" | "south";

/** What a tile is made of. Movement rules per type live in TERRAIN_INFO below. */
export type TerrainType = "plains" | "forest" | "water";

/**
 * The board-wide colour scheme for a match. One biome is chosen at random
 * when a game is created and applies to every tile. Biomes only change how
 * terrain is *drawn* (colours); they never change movement rules.
 */
export type BiomeId = "grass" | "desert" | "ice";

/**
 * The 15 characters each player starts with — one of each, same set on both
 * sides. Characters are pure visual identity: every character moves under
 * exactly the same restrictions, and the engine never branches on character.
 * Display data (label, emoji) lives in CHARACTERS in constants.ts.
 */
export type CharacterId =
  | "cat"
  | "dog"
  | "horse"
  | "mouse"
  | "spider"
  | "elephant"
  | "soldier"
  | "alien"
  | "fox"
  | "bear"
  | "rabbit"
  | "frog"
  | "pig"
  | "owl"
  | "penguin";

/** A game is set up, then played, then finished. It never goes backwards. */
export type GamePhase = "setup" | "playing" | "finished";

/**
 * A board coordinate. x runs 0-29 left to right, y runs 0-30 top to bottom,
 * so (0, 0) is North's back-left corner and (29, 30) is South's back-right.
 */
export interface Position {
  x: number;
  y: number;
}

/** One square of the board: where it is, and what terrain it holds. */
export interface Tile {
  position: Position;
  terrain: TerrainType;
}

/**
 * One of a player's 15 game pieces.
 *
 * A piece's `status` is exactly one of three values, so impossible states
 * (e.g. a piece that has both scored and been eliminated) can't be built:
 * - "active"     — on the board, can move.
 * - "scored"     — reached the opponent's back row and left the board.
 * - "eliminated" — stepped on a trap and left the board.
 */
export interface Piece {
  /** Unique across the whole game, derived from owner + character, e.g. "north-cat". */
  id: string;
  character: CharacterId;
  owner: PlayerId;
  position: Position;
  status: "active" | "scored" | "eliminated";
}

/**
 * A hidden trap placed during setup. A trap only ever harms the *opponent*
 * of its owner. Once it fires (`triggered: true`) it is spent, and its
 * position becomes visible to both players.
 */
export interface Trap {
  owner: PlayerId;
  position: Position;
  triggered: boolean;
}

/**
 * The complete state of one game at one moment.
 *
 * This is the single object every part of the system passes around: the UI
 * renders it, the engine produces the next one from a move, and later the
 * server will store it and send each player a filtered copy (with the
 * opponent's untriggered traps removed).
 */
export interface GameState {
  /** The random seed this game was generated from. Seed + move history = the whole game. */
  seed: number;
  biome: BiomeId;
  /** All 930 tiles. The tile at (x, y) lives at index `y * BOARD_WIDTH + x`. */
  tiles: Tile[];
  pieces: Piece[];
  traps: Trap[];
  phase: GamePhase;
  /** Whose turn it is. Decided at random when the game starts. */
  currentPlayer: PlayerId;
  /** Movement points left in the shared pool for the current turn. */
  movementPointsLeft: number;
  /**
   * Movement points already spent on each piece this turn, keyed by piece id.
   * This is what enforces the per-piece cap; it resets to {} at end of turn.
   */
  spentThisTurn: Record<string, number>;
  /** Pieces scored ("across") per player. First to PIECES_TO_WIN wins. */
  scores: Record<PlayerId, number>;
  winner: PlayerId | null;
  /**
   * Spendable nerf tokens per player (see NERF_SPEC.md). A nerf eliminates
   * one active opponent piece adjacent to one of yours for 1 token + 3
   * pool points. Earned by scoring; capped at NERF_TOKEN_CAP.
   */
  nerfTokens: Record<PlayerId, number>;
  /**
   * Tokens earned this turn. They sit here until endTurn flips them into
   * nerfTokens, so a token can never be spent the turn it was earned.
   */
  nerfTokensPending: Record<PlayerId, number>;
}

/**
 * Movement rules for each terrain type — one place to look them up, and the
 * only place they are defined. Adding a new terrain type later means adding
 * one row here (and one colour per biome in the rendering layer).
 *
 * `costToEnter` is how many movement points from the shared pool it costs to
 * step onto a tile of this type. It is ignored for impassable terrain.
 */
export const TERRAIN_INFO: Record<
  TerrainType,
  { costToEnter: number; passable: boolean }
> = {
  plains: { costToEnter: 1, passable: true },
  forest: { costToEnter: 2, passable: true },
  water: { costToEnter: 0, passable: false },
};
