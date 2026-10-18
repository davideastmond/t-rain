// Game creation and the setup phase: placing pieces and traps.
//
// Two layers live here, and the split matters:
// - Single-tile checks (`canPlacePieceAt`, `canPlaceTrapAt`) answer "may
//   this one thing go here, given what's already placed?" — the UI calls
//   these on every click so it can refuse instantly and say why.
// - `applySetup` validates a *complete* placement all at once and only then
//   produces a new GameState. Nothing enters the game state except through
//   it — including `autoPlaceSetup`, which builds a random placement and
//   submits it through the same door. If auto-placement can pass these
//   checks, any placement that passes them is legal, whoever made it.
//
// All functions are pure: they never mutate the state they are given, they
// return a new one. That is what will let a server re-run the exact same
// validation on a client's submission later.

import { generateBoard, tileIndex } from "./board";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CHARACTERS,
  MAX_NEUTRAL_TRAPS,
  MOVEMENT_POINTS_PER_TURN,
  NEUTRAL_ROW,
  PIECES_PER_PLAYER,
  SETUP_ROWS,
  TRAPS_PER_PLAYER,
} from "./constants";
import { createSeededRng } from "./rng";
import {
  TERRAIN_INFO,
  type CharacterId,
  type GameState,
  type Piece,
  type PlayerId,
  type Position,
  type Trap,
} from "./types";

/** Every character in the game, in roster order. One of each per player. */
export const ALL_CHARACTERS = Object.keys(CHARACTERS) as CharacterId[];

/** Why a placement was refused. The UI turns these into sentences. */
export type SetupError =
  | "wrong-phase"
  | "already-setup"
  | "wrong-piece-count"
  | "duplicate-character"
  | "piece-outside-zone"
  | "wrong-trap-count"
  | "trap-outside-zone"
  | "too-many-neutral-traps"
  | "duplicate-position"
  | "on-water";

export type Validation = { ok: true } | { ok: false; error: SetupError };

export type ApplySetupResult =
  | { ok: true; state: GameState }
  | { ok: false; error: SetupError };

export function otherPlayer(player: PlayerId): PlayerId {
  return player === "north" ? "south" : "north";
}

function samePosition(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y;
}

function isOnBoard(position: Position): boolean {
  return (
    position.x >= 0 &&
    position.x < BOARD_WIDTH &&
    position.y >= 0 &&
    position.y < BOARD_HEIGHT
  );
}

/** The rows a player's pieces may start in: their own back SETUP_ROWS rows. */
export function isInPieceZone(player: PlayerId, position: Position): boolean {
  if (player === "north") return position.y < SETUP_ROWS;
  return position.y >= BOARD_HEIGHT - SETUP_ROWS;
}

/** The rows a player's traps may go in: their whole zone plus the neutral row. */
export function isInTrapZone(player: PlayerId, position: Position): boolean {
  if (player === "north") return position.y <= NEUTRAL_ROW;
  return position.y >= NEUTRAL_ROW;
}

function tileAt(state: GameState, position: Position) {
  return state.tiles[tileIndex(position.x, position.y)];
}

/**
 * May `player` put a piece on `position`, given the pieces they have
 * already placed in this setup draft (`alreadyPlaced`)? Pieces already in
 * the game state (the opponent's, if they set up first) also block.
 */
export function canPlacePieceAt(
  state: GameState,
  player: PlayerId,
  position: Position,
  alreadyPlaced: Position[],
): Validation {
  if (!isOnBoard(position) || !isInPieceZone(player, position)) {
    return { ok: false, error: "piece-outside-zone" };
  }
  if (!TERRAIN_INFO[tileAt(state, position).terrain].passable) {
    return { ok: false, error: "on-water" };
  }
  const occupied =
    alreadyPlaced.some((p) => samePosition(p, position)) ||
    state.pieces.some(
      (piece) => piece.status === "active" && samePosition(piece.position, position),
    );
  if (occupied) return { ok: false, error: "duplicate-position" };
  return { ok: true };
}

/**
 * May `player` put a trap on `position`, given the traps they have already
 * placed in this setup draft? Enforces the trap limit and the neutral-row
 * cap incrementally, so the UI can refuse the exact click that breaks them.
 * Unlike pieces, a trap may share a tile with a piece — even its owner's.
 */
export function canPlaceTrapAt(
  state: GameState,
  player: PlayerId,
  position: Position,
  alreadyPlaced: Position[],
): Validation {
  if (!isOnBoard(position) || !isInTrapZone(player, position)) {
    return { ok: false, error: "trap-outside-zone" };
  }
  if (!TERRAIN_INFO[tileAt(state, position).terrain].passable) {
    return { ok: false, error: "on-water" };
  }
  if (alreadyPlaced.some((p) => samePosition(p, position))) {
    return { ok: false, error: "duplicate-position" };
  }
  if (alreadyPlaced.length >= TRAPS_PER_PLAYER) {
    return { ok: false, error: "wrong-trap-count" };
  }
  if (position.y === NEUTRAL_ROW) {
    const neutralPlaced = alreadyPlaced.filter((p) => p.y === NEUTRAL_ROW).length;
    if (neutralPlaced >= MAX_NEUTRAL_TRAPS) {
      return { ok: false, error: "too-many-neutral-traps" };
    }
  }
  return { ok: true };
}

/**
 * Create a fresh game in the setup phase: board generated from the seed,
 * nobody placed yet, and the first player decided by the seed's stream so
 * re-creating a game from its seed reproduces it exactly.
 */
export function createGame(seed: number): GameState {
  const { biome, tiles } = generateBoard(seed);
  const firstPlayer: PlayerId = createSeededRng(seed)() < 0.5 ? "north" : "south";

  return {
    seed,
    biome,
    tiles,
    pieces: [],
    traps: [],
    phase: "setup",
    currentPlayer: firstPlayer,
    movementPointsLeft: MOVEMENT_POINTS_PER_TURN,
    spentThisTurn: {},
    scores: { north: 0, south: 0 },
    winner: null,
    nerfTokens: { north: 0, south: 0 },
    nerfTokensPending: { north: 0, south: 0 },
  };
}

/**
 * Validate one player's complete setup and add it to the game.
 *
 * `piecePlacements` must cover every character exactly once and
 * `trapPositions` must be exactly TRAPS_PER_PLAYER traps. When the second
 * player applies, the game flips from "setup" to "playing".
 */
export function applySetup(
  state: GameState,
  player: PlayerId,
  piecePlacements: Array<{ character: CharacterId; position: Position }>,
  trapPositions: Position[],
): ApplySetupResult {
  if (state.phase !== "setup") return { ok: false, error: "wrong-phase" };
  if (state.pieces.some((piece) => piece.owner === player)) {
    return { ok: false, error: "already-setup" };
  }

  // --- pieces: full roster, each character exactly once ---
  if (piecePlacements.length !== PIECES_PER_PLAYER) {
    return { ok: false, error: "wrong-piece-count" };
  }
  const characters = new Set(piecePlacements.map((p) => p.character));
  if (characters.size !== piecePlacements.length) {
    return { ok: false, error: "duplicate-character" };
  }
  const placedPositions: Position[] = [];
  for (const { position } of piecePlacements) {
    const check = canPlacePieceAt(state, player, position, placedPositions);
    if (!check.ok) return check;
    placedPositions.push(position);
  }

  // --- traps: exact count, all single-tile rules incl. the neutral cap ---
  if (trapPositions.length !== TRAPS_PER_PLAYER) {
    return { ok: false, error: "wrong-trap-count" };
  }
  const placedTraps: Position[] = [];
  for (const position of trapPositions) {
    const check = canPlaceTrapAt(state, player, position, placedTraps);
    if (!check.ok) return check;
    placedTraps.push(position);
  }

  const newPieces: Piece[] = piecePlacements.map(({ character, position }) => ({
    id: `${player}-${character}`,
    character,
    owner: player,
    position,
    status: "active",
  }));
  const newTraps: Trap[] = trapPositions.map((position) => ({
    owner: player,
    position,
    triggered: false,
  }));

  const pieces = [...state.pieces, ...newPieces];
  const bothPlayersIn = pieces.some((p) => p.owner === otherPlayer(player));

  return {
    ok: true,
    state: {
      ...state,
      pieces,
      traps: [...state.traps, ...newTraps],
      phase: bothPlayersIn ? "playing" : "setup",
    },
  };
}

/**
 * Place a player's whole setup at random — used for the opponent in local
 * play now, and for the setup timer running out later.
 *
 * Deterministic: the stream is seeded from the game seed and the player, so
 * the same game always auto-places the same way. The placement is submitted
 * through applySetup, so it is held to exactly the rules a human is.
 */
export function autoPlaceSetup(state: GameState, player: PlayerId): ApplySetupResult {
  const rng = createSeededRng(state.seed + (player === "north" ? 101 : 202));

  // Fisher–Yates shuffle: every ordering of the candidates equally likely.
  function shuffled<T>(items: T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  const pieceCandidates = shuffled(
    state.tiles
      .filter(
        (tile) =>
          isInPieceZone(player, tile.position) &&
          TERRAIN_INFO[tile.terrain].passable,
      )
      .map((tile) => tile.position),
  );
  const piecePlacements = ALL_CHARACTERS.map((character, i) => ({
    character,
    position: pieceCandidates[i],
  }));

  // Traps: walk shuffled candidates in the trap zone, accepting each one
  // the single-tile check allows (this is what keeps the neutral cap) until
  // the quota is full. Piece tiles are skipped so the two don't stack up.
  const pieceKeys = new Set(piecePlacements.map((p) => tileIndex(p.position.x, p.position.y)));
  const trapCandidates = shuffled(
    state.tiles
      .filter(
        (tile) =>
          isInTrapZone(player, tile.position) &&
          TERRAIN_INFO[tile.terrain].passable &&
          !pieceKeys.has(tileIndex(tile.position.x, tile.position.y)),
      )
      .map((tile) => tile.position),
  );
  const trapPositions: Position[] = [];
  for (const position of trapCandidates) {
    if (trapPositions.length >= TRAPS_PER_PLAYER) break;
    if (canPlaceTrapAt(state, player, position, trapPositions).ok) {
      trapPositions.push(position);
    }
  }

  return applySetup(state, player, piecePlacements, trapPositions);
}
