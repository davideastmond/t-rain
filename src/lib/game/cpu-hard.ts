// Hard CPU, v1: `full`'s composition with danger-aware racing.
//
// This is the first Hard increment (HARD_CPU_SPEC.md rollout step 2):
// everything from `full` is reused unchanged — nerf first, nerf hunting,
// bounded spoiler mode — and only the final racing step is swapped for
// a danger-aware one. Generalized interception, score-first, and
// selective seeking arrive in later PRs; this file must not grow them
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

import {
  chooseCpuAction,
  chooseNerfHuntStep,
  chooseSpoilerStep,
  findPathToGoal,
  isSpoilerMode,
  type CpuAction,
  type CpuStep,
} from "./cpu";
import { legalStepTargets } from "./movement";
import { nerfTargets } from "./nerf";
import { otherPlayer } from "./setup";
import type { GameState, PlayerId, Position } from "./types";

/** Extra route cost for ending a step on a danger tile (tunable). */
export const HARD_DANGER_COST = 2;

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
 * One Hard action, in priority order: nerf (delegated to `full`'s
 * chooser, which returns exactly the nerf when targets exist), nerf
 * hunting, bounded spoiler mode, then the danger-aware race step.
 * Returns null when there's nothing legal to do, which is the caller's
 * cue to end the turn.
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

  const hunt = chooseNerfHuntStep(view, player, rng);
  if (hunt) return { kind: "step", ...hunt };

  if (isSpoilerMode(view, player)) {
    const spoiler = chooseSpoilerStep(view, player, rng);
    if (spoiler) return { kind: "step", ...spoiler };
  }

  const step = chooseHardRaceStep(view, player, rng);
  return step ? { kind: "step", ...step } : null;
}
