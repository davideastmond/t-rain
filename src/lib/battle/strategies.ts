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
// "hard" is Hard v2 (HARD_CPU_SPEC.md rollout step 3): full's
// composition with danger-aware racing, score-first, and generalized
// interception — measured on top of v1's danger-only edge (which was
// zero: 10/20 both seats vs full).
// "seeker" is a lab-only instrument: full's exact composition with one
// insertion — a detour to collect its mystery box when the detour is
// cheap — so box outcomes (trap sense included) finally occur often
// enough in tournaments to measure. The shipped CPU does not seek.

import { tileIndex } from "../game/board";
import { chooseHardAction } from "../game/cpu-hard";
import {
  chooseCpuAction,
  chooseCpuStep,
  chooseNerfHuntStep,
  chooseSpoilerStep,
  findPath,
  findPathToGoal,
  isSpoilerMode,
  piecesToWin,
  sanitizeForPlayer,
  type CpuAction,
} from "../game/cpu";
import { BOARD_HEIGHT, GOAL_ROW, NEUTRAL_ROW } from "../game/constants";
import { legalStepTargets } from "../game/movement";
import { nerfTargets } from "../game/nerf";
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

/**
 * How far out of its way a seeker piece may go for the box, measured
 * against its own goal route: the box route may cost at most this much
 * more than the route straight to the goal row. Relative rather than
 * absolute so it means the same thing early (long routes) and late.
 */
export const SEEK_DETOUR_BUDGET = 4;

/**
 * One box-seeking step for `player`: route a piece onto its mystery
 * box (the uncollected one in the opponent's zone — only the invader
 * can collect it). Returns null when seeking doesn't apply, which is
 * most of the time:
 *
 * - the box is already collected (permanently — from then on the
 *   seeker is indistinguishable from full);
 * - `player` is one score from winning (race instead — the same rule
 *   the nerf hunt uses);
 * - no piece has a box route whose first step is legal right now and
 *   whose cost passes the detour gate: route-to-box <= route-to-goal
 *   + SEEK_DETOUR_BUDGET. A piece with no goal route at all always
 *   passes — a box route that opens the board is free value.
 *
 * A camped box tile is an occupied tile, hence a wall to findPath, so
 * no box route exists and the gate fails by construction. Among
 * candidate pieces the cheapest box route wins (then fewest steps,
 * then rng among ties) — the chooseCpuStep tiebreak pattern.
 */
function chooseSeekStep(
  view: GameState,
  player: PlayerId,
  rng: () => number = Math.random,
): CpuStep | null {
  if (view.phase !== "playing" || view.currentPlayer !== player) return null;
  if (piecesToWin(view, player) <= 1) return null;

  const target = view.mysteryBoxes.find(
    (box) =>
      !box.collected &&
      (player === "north"
        ? box.position.y > NEUTRAL_ROW
        : box.position.y < NEUTRAL_ROW),
  );
  if (!target) return null;
  const boxTile = target.position;

  const bids: { pieceId: string; step: Position; cost: number; steps: number }[] = [];
  for (const piece of view.pieces) {
    if (piece.owner !== player || piece.status !== "active") continue;
    const pathBox = findPath(
      view,
      piece.id,
      (pos) => pos.x === boxTile.x && pos.y === boxTile.y,
    );
    if (!pathBox || pathBox.steps.length === 0) continue;
    const pathGoal = findPathToGoal(view, piece.id);
    if (pathGoal && pathBox.totalCost > pathGoal.totalCost + SEEK_DETOUR_BUDGET) {
      continue;
    }
    const [first] = pathBox.steps;
    if (
      !legalStepTargets(view, piece.id).some(
        (t) => t.x === first.x && t.y === first.y,
      )
    ) {
      continue;
    }
    bids.push({
      pieceId: piece.id,
      step: first,
      cost: pathBox.totalCost,
      steps: pathBox.steps.length,
    });
  }

  if (bids.length === 0) return null;
  bids.sort((a, b) => a.cost - b.cost || a.steps - b.steps);
  const best = bids[0];
  const tied = bids.filter((b) => b.cost === best.cost && b.steps === best.steps);
  const pick = tied[Math.floor(rng() * tied.length)];
  return { pieceId: pick.pieceId, to: pick.step };
}

/**
 * The seeker: `full`'s composition with the seek inserted between
 * spoiler mode and racing. The composition *order* is duplicated here,
 * but every step delegates to the same exported choosers
 * chooseCpuAction uses, so the seeker can never drift from full's
 * algorithms — seeking is provably the only difference. (When a nerf
 * target exists, chooseCpuAction's first branch is the nerf, so
 * delegating to it returns exactly full's nerf.)
 *
 * While a seek is live it takes the action slot — teammates move only
 * on calls where the seeker can't legally step — so a tournament
 * measures the cost of the whole team committing to the box run.
 */
function chooseSeekerAction(
  view: GameState,
  player: PlayerId,
  rng: () => number = Math.random,
): CpuAction | null {
  if (view.phase !== "playing" || view.currentPlayer !== player) return null;

  if (nerfTargets(view, player).length > 0) {
    return chooseCpuAction(view, player, rng);
  }

  const hunt = chooseNerfHuntStep(view, player, rng);
  if (hunt) return { kind: "step", ...hunt };

  if (isSpoilerMode(view, player)) {
    const spoiler = chooseSpoilerStep(view, player, rng);
    if (spoiler) return { kind: "step", ...spoiler };
  }

  const seek = chooseSeekStep(view, player, rng);
  if (seek) return { kind: "step", ...seek };

  const step = chooseCpuStep(view, player, rng);
  return step ? { kind: "step", ...step } : null;
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
    version: "pathfinder@v3",
    label: "Pathfinder v3 (Dijkstra + bridge + revealed-trap routing, no nerf/spoiler)",
    choose: (view, player, rng) => {
      const step = chooseCpuStep(view, player, rng);
      return step ? { kind: "step", ...step } : null;
    },
  },
  {
    id: "full",
    version: "full@v4",
    label: "Full v4 (nerf + hunt + spoiler + pathfinder)",
    choose: chooseCpuAction,
  },
  {
    id: "seeker",
    version: "seeker@v1",
    label: "Seeker v1 (full + box detours, lab only)",
    choose: chooseSeekerAction,
  },
  {
    id: "hard",
    version: "hard@v2",
    label: "Hard v2 (full + danger-aware racing + score-first + interception)",
    choose: chooseHardAction,
  },
];

export function getStrategy(id: string): CpuStrategy {
  const found = CPU_STRATEGIES.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown CPU strategy: ${id}`);
  return found;
}

/** The sanitized view a strategy is allowed to decide from. Re-exported so battle code has one import. */
export { sanitizeForPlayer };
