// CPU opponent: a heuristic turn player for T-rain.
//
// The cardinal rule of this file: the CPU never sees what it shouldn't.
// Every decision is made from sanitizeForPlayer(state, player), which
// removes the opponent's untriggered traps — the exact same filter an
// online server would apply before sending a game to a client. If a
// future, smarter CPU wants to remember where its pieces died, it must
// build that memory from public events (revealed traps), never by
// reading state.traps directly.
//
// The strategy is deliberately simple and greedy, one step at a time:
// each step picks the (piece, target) making the most progress toward the
// goal row per point spent, with a nudge toward pushing the most advanced
// pieces and a little randomness to break ties. It plays the position in
// front of it. It does not know the opponent's hidden traps, so it can't
// play around them — exactly like a human facing hidden information.

import { tileIndex } from "./board";
import { BOARD_HEIGHT, GOAL_ROW, PIECES_TO_WIN } from "./constants";
import { legalStepTargets } from "./movement";
import { nerfTargets } from "./nerf";
import { TERRAIN_INFO, type GameState, type PlayerId, type Position } from "./types";

/**
 * The game as `player` is allowed to see it: everything is intact except
 * the opponent's untriggered traps are removed. Triggered traps are
 * public (they're revealed on the board), and your own traps are yours
 * to know. This is the only state the CPU may decide from.
 */
export function sanitizeForPlayer(state: GameState, player: PlayerId): GameState {
  return {
    ...state,
    traps: state.traps.filter((trap) => trap.owner === player || trap.triggered),
  };
}

export interface CpuStep {
  pieceId: string;
  to: Position;
}

/**
 * One CPU decision: a step, or a nerf.
 */
export type CpuAction =
  | { kind: "step"; pieceId: string; to: Position }
  | { kind: "nerf"; targetPieceId: string };

/**
 * Choose one action for `player` from their sanitized view. Nerf first,
 * per NERF_SPEC.md §8: when holding a token with pool to spend, eliminate
 * the valid target closest to our goal row — the most advanced enemy
 * runner. (nerfTargets already requires a token and pool, so a non-empty
 * result means a nerf is affordable.) Otherwise take the greedy step.
 * Returns null when there's nothing legal to do, which is the page's cue
 * to end the turn.
 */
/**
 * Choose one step for `player` from their sanitized view. Returns null
 * when there's nothing legal to do (pool spent, pieces capped or blocked),
 * which is the page's cue to end the turn.
 *
 * Scoring, per candidate target:
 *   progress * 10          — steps toward the goal row dominate; sideways
 *                             steps score 0, retreats score -10
 *   - terrain cost          — among equal progress, cheaper tiles win
 *   + 5 when it scores      — finishing a piece beats merely advancing
 *   + (BOARD_HEIGHT - dist) * 0.15
 *                           — slight pull toward pushing the pieces that
 *                             are already closest to scoring
 *   + rng() * 2             — tiebreak jitter so play isn't robotic
 *
 * Retreats are only considered when no forward-or-sideways step exists
 * (e.g. routing around water), so the CPU doesn't burn points shuffling
 * backwards.
 */
export function chooseCpuStep(
  view: GameState,
  player: PlayerId,
  rng: () => number = Math.random,
): CpuStep | null {
  if (view.phase !== "playing" || view.currentPlayer !== player) return null;

  const goalY = GOAL_ROW[player];
  const candidates: { pieceId: string; to: Position; score: number; progress: number }[] = [];

  for (const piece of view.pieces) {
    if (piece.owner !== player || piece.status !== "active") continue;
    const distBefore = Math.abs(piece.position.y - goalY);
    for (const to of legalStepTargets(view, piece.id)) {
      const distAfter = Math.abs(to.y - goalY);
      const progress = distBefore - distAfter;
      const cost = TERRAIN_INFO[view.tiles[tileIndex(to.x, to.y)].terrain].costToEnter;
      const score =
        progress * 10 -
        cost +
        (distAfter === 0 ? 5 : 0) +
        (BOARD_HEIGHT - distBefore) * 0.15 +
        rng() * 2;
      candidates.push({ pieceId: piece.id, to, score, progress });
    }
  }

  if (candidates.length === 0) return null;
  const nonRetreats = candidates.filter((c) => c.progress >= 0);
  const pool = nonRetreats.length > 0 ? nonRetreats : candidates;
  pool.sort((a, b) => b.score - a.score);
  return { pieceId: pool[0].pieceId, to: pool[0].to };
}

/** How many pieces `player` still needs to get across to win. */
export function piecesToWin(state: GameState, player: PlayerId): number {
  return PIECES_TO_WIN - state.scores[player];
}

/**
 * Choose one action for `player` from their sanitized view. See the
 * CpuAction docstring for the nerf-first policy.
 */
export function chooseCpuAction(
  view: GameState,
  player: PlayerId,
  rng: () => number = Math.random,
): CpuAction | null {
  if (view.phase !== "playing" || view.currentPlayer !== player) return null;

  const targets = nerfTargets(view, player);
  if (targets.length > 0) {
    const goalY = GOAL_ROW[player];
    let best = targets[0];
    for (const target of targets) {
      if (
        Math.abs(target.position.y - goalY) <
        Math.abs(best.position.y - goalY)
      ) {
        best = target;
      }
    }
    return { kind: "nerf", targetPieceId: best.id };
  }

  const step = chooseCpuStep(view, player, rng);
  return step ? { kind: "step", ...step } : null;
}
