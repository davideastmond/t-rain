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
// The strategy: commit to a route, don't wander. Each tick, every active
// piece gets a cheapest-path route to the goal row (Dijkstra over terrain
// costs, treating water and occupied tiles as walls); the CPU takes the
// first step of the best route. Routes are recomputed every tick, so the
// CPU naturally sticks with a piece while its route stays best and
// switches when it gets blocked or capped. It does not know the
// opponent's hidden traps, so it can't play around them — exactly like a
// human facing hidden information.

import { tileIndex } from "./board";
import { BOARD_WIDTH, GOAL_ROW, PIECES_TO_WIN } from "./constants";
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
 * result means a nerf is affordable.) Otherwise take the best pathfinding
 * step. Returns null when there's nothing legal to do, which is the page's cue
 * to end the turn.
 */
/**
 * A cheapest route for one piece to the goal row, as the CPU sees it.
 */
export interface CpuPath {
  pieceId: string;
  /** Tiles to step onto, in order, starting from the piece's position. */
  steps: Position[];
  /** Sum of costToEnter over every step. */
  totalCost: number;
}

const posKey = (p: Position): string => `${p.x},${p.y}`;

/**
 * Cheapest route for `pieceId` to any tile of its owner's goal row,
 * from the CPU's sanitized view. Dijkstra over the 4-directional grid:
 * each step costs the destination tile's costToEnter (plains 1, forest 2),
 * water is impassable, and tiles occupied by any active piece are walls.
 * Hidden (untriggered) opponent traps can't be routed around — they're
 * not in the view — and spent traps are harmless, so traps play no part.
 * Returns null when no route exists.
 */
export function findPathToGoal(
  view: GameState,
  pieceId: string,
): CpuPath | null {
  const piece = view.pieces.find((p) => p.id === pieceId);
  if (!piece || piece.status !== "active") return null;
  const goalY = GOAL_ROW[piece.owner];

  const blocked = new Set<string>();
  for (const p of view.pieces) {
    if (p.status === "active" && p.id !== pieceId) {
      blocked.add(posKey(p.position));
    }
  }

  const startKey = posKey(piece.position);
  const dist = new Map<string, number>([[startKey, 0]]);
  const prev = new Map<string, string>();
  // Tiny priority queue (930 tiles max — a sorted array is plenty).
  const queue: { key: string; d: number }[] = [{ key: startKey, d: 0 }];
  const DIRS: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  let goalKey: string | null = null;
  while (queue.length > 0) {
    queue.sort((a, b) => a.d - b.d);
    const { key, d } = queue.shift()!;
    if (d > (dist.get(key) ?? Infinity)) continue;
    const [x, y] = key.split(",").map(Number);
    if (y === goalY) {
      goalKey = key;
      break;
    }
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= BOARD_WIDTH || ny < 0 || ny >= view.tiles.length / BOARD_WIDTH) {
        continue;
      }
      const tile = view.tiles[tileIndex(nx, ny)];
      if (tile.terrain === "water") continue;
      const nextKey = `${nx},${ny}`;
      if (blocked.has(nextKey)) continue;
      const nd = d + TERRAIN_INFO[tile.terrain].costToEnter;
      if (nd < (dist.get(nextKey) ?? Infinity)) {
        dist.set(nextKey, nd);
        prev.set(nextKey, key);
        queue.push({ key: nextKey, d: nd });
      }
    }
  }

  if (goalKey === null) return null;
  const steps: Position[] = [];
  for (
    let k: string | undefined = goalKey;
    k !== undefined && k !== startKey;
    k = prev.get(k)
  ) {
    const [x, y] = k.split(",").map(Number);
    steps.unshift({ x, y });
  }
  return { pieceId, steps, totalCost: dist.get(goalKey)! };
}

/**
 * Choose one step for `player` from their sanitized view. Every active
 * piece gets a cheapest route to the goal row; the CPU takes the first
 * step of the best route — lowest total cost, then fewest steps (fewer
 * tiles entered means fewer trap rolls), then a random pick among ties.
 * A route only counts if its first step is legal right now, so the
 * per-piece cap, the pool, and newly-appeared blockers are respected and
 * the CPU switches pieces instead of stalling. Returns null when there's
 * nothing legal to do (pool spent, pieces capped or blocked), which is
 * the page's cue to end the turn.
 */
export function chooseCpuStep(
  view: GameState,
  player: PlayerId,
  rng: () => number = Math.random,
): CpuStep | null {
  if (view.phase !== "playing" || view.currentPlayer !== player) return null;

  const candidates: CpuPath[] = [];
  for (const piece of view.pieces) {
    if (piece.owner !== player || piece.status !== "active") continue;
    const path = findPathToGoal(view, piece.id);
    if (!path || path.steps.length === 0) continue;
    const [first] = path.steps;
    const legal = legalStepTargets(view, piece.id).some(
      (t) => t.x === first.x && t.y === first.y,
    );
    if (!legal) continue;
    candidates.push(path);
  }

  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) => a.totalCost - b.totalCost || a.steps.length - b.steps.length,
  );
  const best = candidates[0];
  const tied = candidates.filter(
    (p) => p.totalCost === best.totalCost && p.steps.length === best.steps.length,
  );
  const pick = tied[Math.floor(rng() * tied.length)];
  return { pieceId: pick.pieceId, to: pick.steps[0] };
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
