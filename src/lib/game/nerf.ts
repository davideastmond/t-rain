// Nerf: the anti-turtle mechanic (see NERF_SPEC.md).
//
// A nerf eliminates one active opponent piece orthogonally adjacent to at
// least one of your active pieces. It costs 1 nerf token (earned by scoring,
// usable from the turn after it was earned) plus NERF_POOL_COST from the
// shared pool. Nerfing is not movement: no trap checks, no per-piece cap,
// and the turn continues afterward.
//
// Like movement.ts, everything here is pure: states go in, new states come
// out, nothing is mutated. canNerf is the single validator — applyNerf and
// the UI's red targeting highlights (nerfTargets) are built on the same
// checks, so what the player sees as possible and what the engine allows
// cannot drift apart.

import { NERF_POOL_COST, PIECES_TO_WIN } from "./constants";
import { getPiece } from "./movement";
import { otherPlayer } from "./setup";
import type { GameState, Piece, PlayerId, Position } from "./types";

/** Why a nerf was refused. The UI turns these into sentences. */
export type NerfError =
  | "wrong-phase"
  | "not-your-turn"
  | "no-token"
  | "insufficient-points"
  | "invalid-target";

export type NerfValidation = { ok: true } | { ok: false; error: NerfError };

/** What a successful nerf did, so the UI can narrate it. */
export interface NerfOutcome {
  /** Id of the eliminated piece. */
  eliminatedPieceId: string;
  /** True when the elimination ended the game by attrition. */
  attritionLoss: boolean;
}

export type NerfResult =
  | { ok: true; state: GameState; outcome: NerfOutcome }
  | { ok: false; error: NerfError };

function isOrthogonalNeighbor(a: Position, b: Position): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

/** The validation table from NERF_SPEC.md §4, in order. */
export function canNerf(
  state: GameState,
  player: PlayerId,
  targetPieceId: string,
): NerfValidation {
  if (state.phase !== "playing") return { ok: false, error: "wrong-phase" };
  if (player !== state.currentPlayer)
    return { ok: false, error: "not-your-turn" };
  if (state.nerfTokens[player] < 1) return { ok: false, error: "no-token" };
  if (state.movementPointsLeft < NERF_POOL_COST)
    return { ok: false, error: "insufficient-points" };
  const target = getPiece(state, targetPieceId);
  if (!target || target.status !== "active" || target.owner === player) {
    return { ok: false, error: "invalid-target" };
  }
  const inRange = state.pieces.some(
    (piece) =>
      piece.owner === player &&
      piece.status === "active" &&
      isOrthogonalNeighbor(piece.position, target.position),
  );
  if (!inRange) return { ok: false, error: "invalid-target" };
  return { ok: true };
}

/**
 * Opponent pieces the player could nerf right now — for the UI's red
 * targeting highlights. Empty when the player can't nerf at all.
 */
export function nerfTargets(state: GameState, player: PlayerId): Piece[] {
  if (state.phase !== "playing" || player !== state.currentPlayer) return [];
  if (state.nerfTokens[player] < 1) return [];
  if (state.movementPointsLeft < NERF_POOL_COST) return [];
  const mine = state.pieces.filter(
    (piece) => piece.owner === player && piece.status === "active",
  );
  return state.pieces.filter(
    (target) =>
      target.owner !== player &&
      target.status === "active" &&
      mine.some((piece) =>
        isOrthogonalNeighbor(piece.position, target.position),
      ),
  );
}

export function applyNerf(
  state: GameState,
  player: PlayerId,
  targetPieceId: string,
): NerfResult {
  const check = canNerf(state, player, targetPieceId);
  if (!check.ok) return check;
  const target = getPiece(state, targetPieceId)!;

  const pieces = state.pieces.map((piece) =>
    piece.id === targetPieceId
      ? { ...piece, status: "eliminated" as const }
      : piece,
  );

  // Attrition, exactly like trap eliminations: if the target's owner drops
  // below PIECES_TO_WIN pieces still able to score, they lose on the spot.
  const stillAbleToScore =
    pieces.filter((p) => p.owner === target.owner && p.status === "active")
      .length + state.scores[target.owner];
  let phase = state.phase;
  let winner = state.winner;
  let attritionLoss = false;
  if (stillAbleToScore < PIECES_TO_WIN) {
    phase = "finished";
    winner = otherPlayer(target.owner);
    attritionLoss = true;
  }

  return {
    ok: true,
    state: {
      ...state,
      pieces,
      phase,
      winner,
      movementPointsLeft: state.movementPointsLeft - NERF_POOL_COST,
      nerfTokens: {
        ...state.nerfTokens,
        [player]: state.nerfTokens[player] - 1,
      },
    },
    outcome: { eliminatedPieceId: targetPieceId, attritionLoss },
  };
}
