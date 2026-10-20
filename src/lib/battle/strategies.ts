// The CPU strategy registry: every CPU the battle lab can field.
//
// Each strategy is a named, *versioned* behavior: `id` is stable ("greedy"),
// `version` moves when the behavior changes ("greedy@v1"). The version is
// what battle logs record, so a tournament run today stays comparable with
// one run after an algo tweak — the log tells you exactly which code played.
// Bump the version string whenever you change what a strategy does.
//
// "full" is the shipped CPU (chooseCpuAction: nerf-first, nerf hunting,
// spoiler mode, pathfinding). "pathfinder" is the same Dijkstra routing
// without nerfs or spoiler play. "greedy" is the original PR #9
// heuristic, kept as the baseline every fancier CPU has to beat.

import { tileIndex } from "../game/board";
import {
  chooseCpuAction,
  chooseCpuStep,
  sanitizeForPlayer,
  type CpuAction,
} from "../game/cpu";
import { BOARD_HEIGHT, GOAL_ROW } from "../game/constants";
import { legalStepTargets } from "../game/movement";
import { TERRAIN_INFO, type GameState, type PlayerId, type Position } from "../game/types";

export interface CpuStep {
  pieceId: string;
  to: Position;
}

export interface CpuStrategy {
  /** Stable name, e.g. "greedy". */
  id: string;
  /** Bump whenever the behavior changes, e.g. "greedy@v2". Recorded in battle logs. */
  version: string;
  /** What the battle page shows in the selector. */
  label: string;
  choose: (
    view: GameState,
    player: PlayerId,
    rng: () => number,
  ) => CpuAction | null;
}

/**
 * The PR #9 greedy heuristic, preserved verbatim as the baseline.
 * One step at a time: each step picks the (piece, target) making the most
 * progress toward the goal row per point spent, with a nudge toward pushing
 * the most advanced pieces and a little randomness to break ties.
 * Retreats are only considered when no forward-or-sideways step exists.
 */
function chooseGreedyStep(
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
      const cost =
        TERRAIN_INFO[view.tiles[tileIndex(to.x, to.y)].terrain].costToEnter;
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

export const CPU_STRATEGIES: CpuStrategy[] = [
  {
    id: "greedy",
    version: "greedy@v1",
    label: "Greedy v1 (PR #9 baseline)",
    choose: (view, player, rng) => {
      const step = chooseGreedyStep(view, player, rng);
      return step ? { kind: "step", ...step } : null;
    },
  },
  {
    id: "pathfinder",
    version: "pathfinder@v1",
    label: "Pathfinder v1 (Dijkstra, no nerf/spoiler)",
    choose: (view, player, rng) => {
      const step = chooseCpuStep(view, player, rng);
      return step ? { kind: "step", ...step } : null;
    },
  },
  {
    id: "full",
    version: "full@v2",
    label: "Full v2 (nerf + hunt + spoiler + pathfinder)",
    choose: chooseCpuAction,
  },
];

export function getStrategy(id: string): CpuStrategy {
  const found = CPU_STRATEGIES.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown CPU strategy: ${id}`);
  return found;
}

/** The sanitized view a strategy is allowed to decide from. Re-exported so battle code has one import. */
export { sanitizeForPlayer };
