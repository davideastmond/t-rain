// Hard CPU, v2: `full`'s composition with danger-aware racing,
// score-first, and generalized interception.
//
// Rollout step 3 (HARD_CPU_SPEC.md): step 2's danger-aware racing stays,
// and two more rules layer on top — an explicit scoring step outranks
// everything but a nerf, and interception fires whenever the opponent
// is genuinely ahead (not just in `full`'s narrow spoiler window).
// Selective seeking arrives in a later PR; this file must not grow it
// early, so each increment stays measurable on its own.
//
// Danger: a step that ends orthogonally adjacent to an enemy piece is
// dangerous when that enemy's owner holds a usable nerf token. Usable
// tokens are the whole condition: the enemy's pool refills to 10 at the
// start of their turn, so pool is never the binding constraint, and
// pending tokens don't count (they only become usable at their owner's
// endTurn, i.e. after the danger has passed). The penalty is a cost,
// not a wall — Hard still takes a dangerous step when the route is
// otherwise clearly best. And the penalty applies to the step being
// taken, which is the right granularity for this architecture: the CPU
// acts one step per tick and re-evaluates each tick, so the step it
// takes is where the piece rests if the pool runs out.
//
// Fairness: like `full`, every decision here is made from the sanitized
// view the caller passes in. Nothing in this file reads hidden traps.

import { tileIndex } from "./board";
import { GOAL_ROW } from "./constants";
import {
  chooseCpuAction,
  chooseNerfHuntStep,
  chooseSpoilerStep,
  findPathToGoal,
  piecesToWin,
  type CpuAction,
  type CpuStep,
} from "./cpu";
import { legalStepTargets } from "./movement";
import { nerfTargets } from "./nerf";
import { otherPlayer } from "./setup";
import { TERRAIN_INFO, type GameState, type PlayerId, type Position } from "./types";

/** Extra route cost for ending a step on a danger tile (tunable). */
export const HARD_DANGER_COST = 2;

/** Interception trigger (tunable): the opponent's best runner is this
    many steps or fewer from scoring... */
export const HARD_INTERCEPT_RANGE = 6;
/** ...and Hard's own best runner is at least this many steps further
    from scoring. */
export const HARD_INTERCEPT_BEHIND = 3;

/**
 * Whether stepping onto `pos` would park `player`'s piece next to an
 * enemy piece whose owner could nerf it on the next turn.
 */
export function isDangerTile(
  view: GameState,
  player: PlayerId,
  pos: Position,
): boolean {
  const foe = otherPlayer(player);
  if (view.nerfTokens[foe] < 1) return false;
  return view.pieces.some(
    (piece) =>
      piece.owner === foe &&
      piece.status === "active" &&
      Math.abs(piece.position.x - pos.x) +
        Math.abs(piece.position.y - pos.y) ===
        1,
  );
}

/**
 * Danger-aware racing step: `chooseCpuStep`'s selection with one change
 * — a candidate's cost is its route cost plus HARD_DANGER_COST when its
 * first step lands on a danger tile. Same tiebreaks otherwise (fewest
 * steps, then seeded randomness), same legality rule (a route only
 * counts if its first step is legal right now). With no danger on the
 * board this reduces exactly to `chooseCpuStep`.
 */
export function chooseHardRaceStep(
  view: GameState,
  player: PlayerId,
  rng: () => number = Math.random,
): CpuStep | null {
  if (view.phase !== "playing" || view.currentPlayer !== player) return null;

  const candidates: {
    pieceId: string;
    to: Position;
    cost: number;
    steps: number;
  }[] = [];
  for (const piece of view.pieces) {
    if (piece.owner !== player || piece.status !== "active") continue;
    const path = findPathToGoal(view, piece.id);
    if (!path || path.steps.length === 0) continue;
    const [first] = path.steps;
    const legal = legalStepTargets(view, piece.id).some(
      (t) => t.x === first.x && t.y === first.y,
    );
    if (!legal) continue;
    candidates.push({
      pieceId: piece.id,
      to: first,
      cost:
        path.totalCost +
        (isDangerTile(view, player, first) ? HARD_DANGER_COST : 0),
      steps: path.steps.length,
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.cost - b.cost || a.steps - b.steps);
  const best = candidates[0];
  const tied = candidates.filter(
    (p) => p.cost === best.cost && p.steps === best.steps,
  );
  const pick = tied[Math.floor(rng() * tied.length)];
  return { pieceId: pick.pieceId, to: pick.to };
}

/**
 * A step that scores this turn, if one exists: a legal step onto the
 * player's goal row on land. A water tile never scores, even on the
 * goal row, and neither does a step onto a known live opponent trap
 * (the trap fires first and the piece dies) — both are excluded, so a
 * returned step genuinely scores. Own and triggered traps are
 * harmless and don't exclude. Cheapest scoring step wins, seeded
 * randomness breaks ties.
 */
export function chooseScoringStep(
  view: GameState,
  player: PlayerId,
  rng: () => number = Math.random,
): CpuStep | null {
  if (view.phase !== "playing" || view.currentPlayer !== player) return null;
  const goalY = GOAL_ROW[player];
  const candidates: { pieceId: string; to: Position; cost: number }[] = [];
  for (const piece of view.pieces) {
    if (piece.owner !== player || piece.status !== "active") continue;
    for (const to of legalStepTargets(view, piece.id)) {
      if (to.y !== goalY) continue;
      const tile = view.tiles[tileIndex(to.x, to.y)];
      if (tile.terrain === "water") continue;
      const knownTrap = view.traps.some(
        (trap) =>
          !trap.triggered &&
          trap.owner !== player &&
          trap.position.x === to.x &&
          trap.position.y === to.y,
      );
      if (knownTrap) continue;
      candidates.push({
        pieceId: piece.id,
        to,
        cost: TERRAIN_INFO[tile.terrain].costToEnter,
      });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.cost - b.cost);
  const best = candidates[0];
  const tied = candidates.filter((c) => c.cost === best.cost);
  const pick = tied[Math.floor(rng() * tied.length)];
  return { pieceId: pick.pieceId, to: pick.to };
}

/** Fewest steps any active piece of `player` needs to reach its goal
    row, or null when no piece has a route. */
function bestStepsToGoal(view: GameState, player: PlayerId): number | null {
  let best: number | null = null;
  for (const piece of view.pieces) {
    if (piece.owner !== player || piece.status !== "active") continue;
    const path = findPathToGoal(view, piece.id);
    if (!path) continue;
    if (best === null || path.steps.length < best) best = path.steps.length;
  }
  return best;
}

/**
 * Whether Hard should intercept this turn. This is `full`'s spoiler
 * window, preserved exactly (opponent needs one score, Hard needs two
 * or more), OR the generalized trigger: the opponent's best runner is
 * within HARD_INTERCEPT_RANGE steps of scoring while Hard's own best
 * runner is at least HARD_INTERCEPT_BEHIND steps further back.
 * When Hard is ahead or tied it races — interception is a comeback
 * tool, not a default, because standing on a path costs the
 * interceptor its own race.
 */
export function shouldInterceptHard(view: GameState, player: PlayerId): boolean {
  const foe = otherPlayer(player);
  if (piecesToWin(view, foe) === 1 && piecesToWin(view, player) > 1) {
    return true;
  }
  const foeBest = bestStepsToGoal(view, foe);
  const ownBest = bestStepsToGoal(view, player);
  if (foeBest === null || ownBest === null) return false;
  return (
    foeBest <= HARD_INTERCEPT_RANGE &&
    ownBest - foeBest >= HARD_INTERCEPT_BEHIND
  );
}

/**
 * One Hard action, in priority order: nerf (delegated to `full`'s
 * chooser, which returns exactly the nerf when targets exist), scoring
 * step, nerf hunting, interception (generalized trigger), then the
 * danger-aware race step. Returns null when there's nothing legal to
 * do, which is the caller's cue to end the turn.
 */
export function chooseHardAction(
  view: GameState,
  player: PlayerId,
  rng: () => number = Math.random,
): CpuAction | null {
  if (view.phase !== "playing" || view.currentPlayer !== player) return null;

  if (nerfTargets(view, player).length > 0) {
    return chooseCpuAction(view, player, rng);
  }

  const scoring = chooseScoringStep(view, player, rng);
  if (scoring) return { kind: "step", ...scoring };

  const hunt = chooseNerfHuntStep(view, player, rng);
  if (hunt) return { kind: "step", ...hunt };

  if (shouldInterceptHard(view, player)) {
    const spoiler = chooseSpoilerStep(view, player, rng);
    if (spoiler) return { kind: "step", ...spoiler };
  }

  const step = chooseHardRaceStep(view, player, rng);
  return step ? { kind: "step", ...step } : null;
}
