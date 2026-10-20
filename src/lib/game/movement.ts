// Movement: the heart of the game, played one tile-step at a time.
//
// A "move" in T-rain is a single step onto an adjacent tile, because traps
// trigger on *every tile entered* — a 3-step dash is three calls to
// movePieceStep, and any step can end it. Everything is validated against
// the same rules the UI uses to highlight legal targets (legalStepTargets
// is built on canStep), so what the player sees as possible and what the
// engine allows cannot drift apart.
//
// Costs come from the shared pool (state.movementPointsLeft) with a
// per-piece cap tracked in state.spentThisTurn; endTurn hands over, refills
// the pool, and clears the per-piece tally. Like setup.ts, every function
// is pure: states go in, new states come out, nothing is mutated.

import { tileIndex } from "./board";
import { boxCollector, mysteryBoxAt, rollMysteryBox } from "./boxes";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  EXTRA_STEPS_POINTS,
  GOAL_ROW,
  MAX_POINTS_PER_PIECE_PER_TURN,
  MOVEMENT_POINTS_PER_TURN,
  NERF_TOKEN_CAP,
  PIECES_TO_WIN,
} from "./constants";
import { otherPlayer } from "./setup";
import {
  TERRAIN_INFO,
  type GameState,
  type MysteryBoxOutcome,
  type Piece,
  type Position,
} from "./types";

/** Why a step was refused. The UI turns these into sentences. */
export type MoveError =
  | "wrong-phase"
  | "piece-not-found"
  | "piece-not-active"
  | "not-your-turn"
  | "not-adjacent"
  | "on-water"
  | "occupied"
  | "exceeds-piece-cap"
  | "insufficient-points";

export type MoveValidation = { ok: true } | { ok: false; error: MoveError };

/** What a successful step did, so the UI can narrate it. */
export interface StepOutcome {
  /** Movement points the step cost (the destination tile's terrain cost). */
  cost: number;
  /** True when the step ended on an opponent's trap: the piece is gone. */
  eliminated: boolean;
  /** True when the step reached the goal row: the piece scored. */
  scored: boolean;
  /** The mystery box outcome when this step collected one, else null. */
  box: MysteryBoxOutcome | null;
}

export type StepResult =
  | { ok: true; state: GameState; outcome: StepOutcome }
  | { ok: false; error: MoveError };

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

export function getPiece(state: GameState, pieceId: string): Piece | undefined {
  return state.pieces.find((piece) => piece.id === pieceId);
}

/** The active piece standing on a tile, if any. Pieces block movement. */
export function pieceAt(state: GameState, position: Position): Piece | undefined {
  return state.pieces.find(
    (piece) => piece.status === "active" && samePosition(piece.position, position),
  );
}

/**
 * May `pieceId` step onto `to` right now? Checks, in order: the game is
 * being played, the piece exists, is still on the board, belongs to the
 * player whose turn it is, the step is one tile orthogonally (no diagonals,
 * no staying), the destination is passable and unoccupied, the shared pool
 * can pay the terrain cost, and the piece's per-turn cap has room for it.
 */
export function canStep(
  state: GameState,
  pieceId: string,
  to: Position,
): MoveValidation {
  if (state.phase !== "playing") return { ok: false, error: "wrong-phase" };

  const piece = getPiece(state, pieceId);
  if (!piece) return { ok: false, error: "piece-not-found" };
  if (piece.status !== "active") return { ok: false, error: "piece-not-active" };
  if (piece.owner !== state.currentPlayer) {
    return { ok: false, error: "not-your-turn" };
  }

  const distance =
    Math.abs(to.x - piece.position.x) + Math.abs(to.y - piece.position.y);
  if (!isOnBoard(to) || distance !== 1) {
    return { ok: false, error: "not-adjacent" };
  }

  const terrain = state.tiles[tileIndex(to.x, to.y)].terrain;
  const info = TERRAIN_INFO[terrain];
  if (!info.passable) return { ok: false, error: "on-water" };
  if (pieceAt(state, to)) return { ok: false, error: "occupied" };

  // Free points (a mystery box's extra steps) pay first: only the part
  // of the cost they don't cover draws on the pool, and only that part
  // counts toward the per-piece cap.
  const fromPool = Math.max(
    0,
    info.costToEnter - (state.bonusPoints[pieceId] ?? 0),
  );
  if ((state.spentThisTurn[pieceId] ?? 0) + fromPool > MAX_POINTS_PER_PIECE_PER_TURN) {
    return { ok: false, error: "exceeds-piece-cap" };
  }
  if (fromPool > state.movementPointsLeft) {
    return { ok: false, error: "insufficient-points" };
  }
  return { ok: true };
}

/** The tiles a piece may step onto right now — what the UI highlights. */
export function legalStepTargets(state: GameState, pieceId: string): Position[] {
  const piece = getPiece(state, pieceId);
  if (!piece || piece.status !== "active") return [];

  const candidates: Position[] = [
    { x: piece.position.x, y: piece.position.y - 1 },
    { x: piece.position.x, y: piece.position.y + 1 },
    { x: piece.position.x - 1, y: piece.position.y },
    { x: piece.position.x + 1, y: piece.position.y },
  ];
  return candidates.filter((to) => canStep(state, pieceId, to).ok);
}

/**
 * Move one piece one step, resolving everything the step causes:
 *
 * 1. The cost is paid — the piece's free points (mystery box) first,
 *    then the shared pool; only the pool part joins the piece's tally.
 * 2. Traps resolve on entry, before anything else: if the destination holds
 *    an opponent's untriggered trap, it fires — the trap is spent and
 *    revealed, the piece is eliminated (even on the goal row: a trapped
 *    goal tile does not score).
 * 3. A mystery box on the destination is collected on entry when the
 *    piece belongs to its collector: the roll grants free points or a
 *    bridge, or booby-traps the piece (eliminated, like a trap). A box
 *    tile never holds a trap, so steps 2 and 3 can't coincide.
 * 4. Otherwise, if the destination is the piece's goal row, it scores.
 * 5. Winning and losing are checked immediately: reaching PIECES_TO_WIN
 *    scored wins; dropping below PIECES_TO_WIN pieces still able to score
 *    (active + already scored) loses on the spot.
 */
export function movePieceStep(
  state: GameState,
  pieceId: string,
  to: Position,
): StepResult {
  const check = canStep(state, pieceId, to);
  if (!check.ok) return check;

  const piece = getPiece(state, pieceId)!;
  const cost = TERRAIN_INFO[state.tiles[tileIndex(to.x, to.y)].terrain].costToEnter;
  // Free points pay first; the pool covers the rest (see canStep).
  const fromBonus = Math.min(state.bonusPoints[pieceId] ?? 0, cost);
  const fromPool = cost - fromBonus;

  // Whose trap, if any, is waiting on the destination? Only the opponent's
  // traps can hurt this piece; its owner's traps are safe to stand on.
  const trapIndex = state.traps.findIndex(
    (trap) =>
      !trap.triggered &&
      trap.owner !== piece.owner &&
      samePosition(trap.position, to),
  );
  const trapped = trapIndex >= 0;

  // Mystery box collection, on entry like traps. For the home player the
  // box is inert; only its collector rolls.
  const box = mysteryBoxAt(state, to);
  const collects =
    !trapped &&
    box !== undefined &&
    !box.collected &&
    boxCollector(to) === piece.owner;
  const boxOutcome = collects ? rollMysteryBox(state) : null;

  const eliminated = trapped || boxOutcome === "booby-trap";
  const scored = !eliminated && to.y === GOAL_ROW[piece.owner];

  const pieces = state.pieces.map((p) => {
    if (p.id !== pieceId) return p;
    if (eliminated) return { ...p, position: to, status: "eliminated" as const };
    if (scored) return { ...p, position: to, status: "scored" as const };
    return {
      ...p,
      position: to,
      hasBridge: p.hasBridge || boxOutcome === "bridge",
    };
  });
  const traps =
    trapIndex >= 0
      ? state.traps.map((trap, i) =>
          i === trapIndex ? { ...trap, triggered: true } : trap,
        )
      : state.traps;
  const mysteryBoxes = collects
    ? state.mysteryBoxes.map((b) => (b === box ? { ...b, collected: true } : b))
    : state.mysteryBoxes;
  let bonusPoints = state.bonusPoints;
  if (fromBonus > 0 || boxOutcome === "extra-steps") {
    bonusPoints = {
      ...state.bonusPoints,
      [pieceId]:
        (state.bonusPoints[pieceId] ?? 0) -
        fromBonus +
        (boxOutcome === "extra-steps" ? EXTRA_STEPS_POINTS : 0),
    };
  }
  const scores = scored
    ? { ...state.scores, [piece.owner]: state.scores[piece.owner] + 1 }
    : state.scores;
  // Scoring earns a nerf token into the pending count (usable from next
  // turn). Tokens beyond NERF_TOKEN_CAP are lost — no stockpiling.
  const nerfTokensPending =
    scored &&
    state.nerfTokens[piece.owner] + state.nerfTokensPending[piece.owner] <
      NERF_TOKEN_CAP
      ? {
          ...state.nerfTokensPending,
          [piece.owner]: state.nerfTokensPending[piece.owner] + 1,
        }
      : state.nerfTokensPending;

  // Win / loss, in one place, the moment the step resolves.
  let phase = state.phase;
  let winner = state.winner;
  if (scores[piece.owner] >= PIECES_TO_WIN) {
    phase = "finished";
    winner = piece.owner;
  } else if (eliminated) {
    const stillAbleToScore =
      pieces.filter((p) => p.owner === piece.owner && p.status === "active")
        .length + scores[piece.owner];
    if (stillAbleToScore < PIECES_TO_WIN) {
      phase = "finished";
      winner = otherPlayer(piece.owner);
    }
  }

  return {
    ok: true,
    state: {
      ...state,
      pieces,
      traps,
      scores,
      phase,
      winner,
      nerfTokensPending,
      mysteryBoxes,
      bonusPoints,
      boxRolls: state.boxRolls + (collects ? 1 : 0),
      movementPointsLeft: state.movementPointsLeft - fromPool,
      spentThisTurn: {
        ...state.spentThisTurn,
        [pieceId]: (state.spentThisTurn[pieceId] ?? 0) + fromPool,
      },
    },
    outcome: { cost, eliminated, scored, box: boxOutcome },
  };
}

/**
 * End the current player's turn: the other player takes over with a full
 * pool, and the per-piece tallies reset (unspent points are lost — no
 * banking). Tokens earned this turn flip from pending to usable, and
 * unused mystery-box free points expire. A player may end their turn at
 * any point during play.
 */
export function endTurn(
  state: GameState,
): { ok: true; state: GameState } | { ok: false; error: "wrong-phase" } {
  if (state.phase !== "playing") return { ok: false, error: "wrong-phase" };
  const player = state.currentPlayer;
  return {
    ok: true,
    state: {
      ...state,
      currentPlayer: otherPlayer(player),
      movementPointsLeft: MOVEMENT_POINTS_PER_TURN,
      spentThisTurn: {},
      bonusPoints: {},
      nerfTokens: {
        ...state.nerfTokens,
        [player]: Math.min(
          NERF_TOKEN_CAP,
          state.nerfTokens[player] + state.nerfTokensPending[player],
        ),
      },
      nerfTokensPending: { ...state.nerfTokensPending, [player]: 0 },
    },
  };
}
