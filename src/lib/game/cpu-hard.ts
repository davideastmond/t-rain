// Hard CPU, v4: v2's rules plus 1-ply lookahead.
//
// Rollout step 4 (HARD_CPU_PHASE2_SPEC.md §3): the v3 nerf threshold
// was measured negative twice and dropped — it never shipped, so this
// version builds on v2, not v3. The hand rules stay and now supply
// lookahead's candidates (nerf, scoring step, hunt, interception,
// danger race, in priority order). Each candidate is simulated, then
// the opponent's best reply under `full`'s policy is simulated, and
// the resulting position is evaluated. The best-evaluated candidate
// wins; ties keep priority order.
//
// Fairness, same as ever: decisions come from the sanitized view.
// The opponent's simulated reply is chosen from *their* sanitized
// view (they can't route around traps they can't see); only the
// outcome is computed on the true simulated state, which is exactly
// how the real game resolves a blind reply against the mover's traps.
//
// Approximation, documented: the opponent reply is simulated with a
// fresh pool and the player switched, but without endTurn side effects
// (pending-token flips, drowning). Those change the evaluation by at
// most a token or a bridge piece, and running full turn semantics
// inside every candidate would cost more than the ply is worth.
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
import { GOAL_ROW, MOVEMENT_POINTS_PER_TURN } from "./constants";
import {
  chooseCpuAction,
  chooseNerfHuntStep,
  chooseSpoilerStep,
  findPathToGoal,
  piecesToWin,
  sanitizeForPlayer,
  type CpuAction,
  type CpuStep,
} from "./cpu";
import { legalStepTargets, movePieceStep } from "./movement";
import { applyNerf, nerfTargets } from "./nerf";
import { otherPlayer } from "./setup";
import { TERRAIN_INFO, type GameState, type PlayerId, type Position } from "./types";

/** Lookahead evaluation weights (tunable, see HARD_CPU_PHASE2_SPEC.md
    §3.1 — initial values, tuned on a probe set before the tournament,
    not locked blind). W_SCORE is deliberately larger than the maximum
    positional swing (30 rows × 10 + 15 pieces × 5 + 2 tokens × 3 =
    381), so a point always beats any positional term — scoring must
    never lose to hunting or racing on evaluation arithmetic. */
export const LOOKAHEAD_W_SCORE = 1000;
export const LOOKAHEAD_W_STEPS = 10;
export const LOOKAHEAD_W_PIECES = 5;
export const LOOKAHEAD_W_TOKENS = 3;
/** Candidate cap (the hand rules yield at most 5, so this never binds
    today — it bounds future candidate sources). */
export const LOOKAHEAD_CANDIDATES = 8;
/** Evaluation for a finished game, from the winner's perspective. */
const WIN_VALUE = 100000;

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
/** Fewest rows any active piece of `player` is from its goal row
    (row distance, not Dijkstra steps — a cheap advancement proxy for
    evaluation; the candidate choosers already did the real routing). */
function bestRowDistance(view: GameState, player: PlayerId): number {
  const goalY = GOAL_ROW[player];
  let best = Infinity;
  for (const piece of view.pieces) {
    if (piece.owner !== player || piece.status !== "active") continue;
    best = Math.min(best, Math.abs(piece.position.y - goalY));
  }
  return best === Infinity ? 31 : best;
}

/**
 * Position evaluation from `player`'s perspective: score difference
 * dominates, then advancement (opponent's best minus own best, so
 * closing in counts), then material, then usable tokens. A finished
 * game is worth far more than any positional term.
 */
export function evaluatePosition(view: GameState, player: PlayerId): number {
  if (view.phase === "finished") {
    if (view.winner === player) return WIN_VALUE;
    if (view.winner) return -WIN_VALUE;
    return 0;
  }
  const foe = otherPlayer(player);
  const scoreDiff = view.scores[player] - view.scores[foe];
  const stepsDiff = bestRowDistance(view, foe) - bestRowDistance(view, player);
  const myActive = view.pieces.filter(
    (p) => p.owner === player && p.status === "active",
  ).length;
  const foeActive = view.pieces.filter(
    (p) => p.owner === foe && p.status === "active",
  ).length;
  const tokenDiff = view.nerfTokens[player] - view.nerfTokens[foe];
  return (
    LOOKAHEAD_W_SCORE * scoreDiff +
    LOOKAHEAD_W_STEPS * stepsDiff +
    LOOKAHEAD_W_PIECES * (myActive - foeActive) +
    LOOKAHEAD_W_TOKENS * tokenDiff
  );
}

/** Apply an action to a state, or null when the engine refuses it
    (candidates come from legal choosers, so this is defensive). */
function applyAction(
  state: GameState,
  player: PlayerId,
  action: CpuAction,
): GameState | null {
  if (action.kind === "nerf") {
    const result = applyNerf(state, player, action.targetPieceId);
    return result.ok ? result.state : null;
  }
  const result = movePieceStep(state, action.pieceId, action.to);
  return result.ok ? result.state : null;
}

function sameAction(a: CpuAction, b: CpuAction): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "nerf" && b.kind === "nerf") {
    return a.targetPieceId === b.targetPieceId;
  }
  if (a.kind === "step" && b.kind === "step") {
    return (
      a.pieceId === b.pieceId && a.to.x === b.to.x && a.to.y === b.to.y
    );
  }
  return false;
}

/**
 * One Hard action by 1-ply lookahead: collect the hand rules'
 * candidates in priority order (nerf, scoring step, hunt,
 * interception, danger race), simulate each plus the opponent's best
 * reply under `full`'s policy, and return the best-evaluated one.
 * Ties keep priority order. Returns null when no rule has anything,
 * which is the caller's cue to end the turn.
 */
export function chooseHardAction(
  view: GameState,
  player: PlayerId,
  rng: () => number = Math.random,
): CpuAction | null {
  if (view.phase !== "playing" || view.currentPlayer !== player) return null;
  const foe = otherPlayer(player);

  const candidates: CpuAction[] = [];
  const push = (action: CpuAction | null) => {
    if (action && !candidates.some((c) => sameAction(c, action))) {
      candidates.push(action);
    }
  };
  if (nerfTargets(view, player).length > 0) {
    push(chooseCpuAction(view, player, rng));
  }
  const scoring = chooseScoringStep(view, player, rng);
  if (scoring) push({ kind: "step", ...scoring });
  const hunt = chooseNerfHuntStep(view, player, rng);
  if (hunt) push({ kind: "step", ...hunt });
  if (shouldInterceptHard(view, player)) {
    const spoiler = chooseSpoilerStep(view, player, rng);
    if (spoiler) push({ kind: "step", ...spoiler });
  }
  const race = chooseHardRaceStep(view, player, rng);
  if (race) push({ kind: "step", ...race });

  const shortlist = candidates.slice(0, LOOKAHEAD_CANDIDATES);
  if (shortlist.length === 0) return null;

  let best: CpuAction | null = null;
  let bestScore = -Infinity;
  for (const candidate of shortlist) {
    const sim = applyAction(view, player, candidate);
    if (!sim) continue;
    let evaluated = sim;
    if (sim.phase !== "finished") {
      // Opponent's turn, fresh pool; reply chosen from their
      // sanitized view (see the header comment on fairness).
      const replyState: GameState = {
        ...sim,
        currentPlayer: foe,
        movementPointsLeft: MOVEMENT_POINTS_PER_TURN,
        spentThisTurn: {},
      };
      const reply = chooseCpuAction(
        sanitizeForPlayer(replyState, foe),
        foe,
        rng,
      );
      if (reply) {
        const replySim = applyAction(replyState, foe, reply);
        if (replySim) evaluated = replySim;
      }
    }
    const score = evaluatePosition(evaluated, player);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}
