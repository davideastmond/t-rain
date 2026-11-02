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
// switches when it gets blocked or capped. When it holds a nerf token
// but no target is adjacent yet, it hunts: routing a piece next to one
// of the opponent's most advanced runners to manufacture the nerf. When
// the opponent is one score from winning and the race is lost, it
// switches to spoiler mode: intercepting the most imminent threat's path
// instead of advancing.
// It does not know the opponent's hidden traps, so it can't play around
// them — exactly like a human facing hidden information.

import { tileIndex } from "./board";
import {
  BOARD_WIDTH,
  GOAL_ROW,
  MAX_POINTS_PER_PIECE_PER_TURN,
  NERF_POOL_COST,
  PICKUP_POWER_COST,
  PIECES_TO_WIN,
  WATER_CROSS_COST,
} from "./constants";
import { legalStepTargets } from "./movement";
import { nerfTargets } from "./nerf";
import { canPlacePickupTrap, canTerraform } from "./pickups";
import { otherPlayer } from "./setup";
import {
  TERRAIN_INFO,
  type GameState,
  type PickupPowerKind,
  type PlayerId,
  type Position,
  type TerrainType,
} from "./types";

/**
 * The game as `player` is allowed to see it: everything is intact except
 * the opponent's untriggered traps are removed — unless trap sense has
 * revealed one to this player (POWERUPS_SPEC.md §6), in which case it
 * stays. Triggered traps are public (they're revealed on the board),
 * and your own traps are yours to know. The opponent's *revealed set*
 * is also redacted: what the other side has learned is itself private,
 * so the returned state carries only the viewer's own revealedTraps.
 * This is the only state the CPU may decide from.
 */
export function sanitizeForPlayer(state: GameState, player: PlayerId): GameState {
  // The game is over: hidden information ends with it, and the
  // post-game board reveals every trap (see the trap-reveal feature).
  // No decisions happen from a finished view, so nothing can exploit it.
  if (state.phase === "finished") return { ...state };
  const revealed = state.revealedTraps[player];
  return {
    ...state,
    traps: state.traps.filter(
      (trap) =>
        trap.owner === player ||
        trap.triggered ||
        revealed.some(
          (position) =>
            position.x === trap.position.x && position.y === trap.position.y,
        ),
    ),
    revealedTraps: {
      north: player === "north" ? revealed : [],
      south: player === "south" ? revealed : [],
    },
    // Uncollected pickups are invisible to everyone; held powers are
    // private like revealed traps (the finished-game path above already
    // returns the full state, so post-game reveals still work).
    pickups: [],
    heldPowers: {
      north: player === "north" ? state.heldPowers.north : [],
      south: player === "south" ? state.heldPowers.south : [],
    },
  };
}

export interface CpuStep {
  pieceId: string;
  to: Position;
}

/**
 * One CPU decision: a step, a nerf, or a pickup-power use.
 */
export type CpuAction =
  | { kind: "step"; pieceId: string; to: Position }
  | { kind: "nerf"; targetPieceId: string }
  | { kind: "use-pickup"; power: PickupPowerKind; position: Position };

/**
 * A cheapest route for one piece to the goal row, as the CPU sees it.
 */
export interface CpuPath {
  pieceId: string;
  /** Tiles to step onto, in order, starting from the piece's position. */
  steps: Position[];
  /** Sum of the step costs over the whole route. */
  totalCost: number;
}

const posKey = (p: Position): string => `${p.x},${p.y}`;

/**
 * Cheapest route for `pieceId` to any tile satisfying `isGoal`, from the
 * CPU's sanitized view. Dijkstra over the 4-directional grid: each step
 * costs the destination tile's costToEnter (plains 1, forest 2), water is
 * impassable, and tiles occupied by any active piece are walls. Traps
 * the viewer *knows* are live are walls too: sanitization removes the
 * opponent's untriggered traps, so the only ones present in a view are
 * spent ones (harmless) and any the viewer revealed with trap sense
 * (POWERUPS_SPEC.md §6) — routes detour around those rather than
 * walking a piece onto a death it could see coming.
 *
 * Bridge exception: a piece holding a mystery-box bridge may enter one
 * water tile at WATER_CROSS_COST, exactly as the movement engine allows.
 * The search tracks whether the bridge is still in hand (keys gain a
 * ",spent" layer once it is used), so a route never plans a second
 * water entry — and from a water tile only land is reachable, so routes
 * always complete the crossing rather than stranding the piece.
 * Returns null when no route exists.
 */
export function findPath(
  view: GameState,
  pieceId: string,
  isGoal: (pos: Position) => boolean,
): CpuPath | null {
  const piece = view.pieces.find((p) => p.id === pieceId);
  if (!piece || piece.status !== "active") return null;

  const blocked = new Set<string>();
  for (const p of view.pieces) {
    if (p.status === "active" && p.id !== pieceId) {
      blocked.add(posKey(p.position));
    }
  }
  // Revealed traps are walls (see the header comment): an untriggered
  // opponent trap can only be in this view because trap sense revealed
  // it to the viewer. The viewer's own traps stay walkable — they only
  // ever harm the opponent.
  for (const trap of view.traps) {
    if (!trap.triggered && trap.owner !== piece.owner) {
      blocked.add(posKey(trap.position));
    }
  }

  const startKey = posKey(piece.position);
  const dist = new Map<string, number>([[startKey, 0]]);
  const prev = new Map<string, string>();
  // Tiny priority queue (930 tiles max, two bridge layers — a sorted
  // array is plenty).
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
    const parts = key.split(",");
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    const bridgeSpent = parts.length > 2;
    if (isGoal({ x, y })) {
      goalKey = key;
      break;
    }
    const currentTerrain = view.tiles[tileIndex(x, y)].terrain;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= BOARD_WIDTH || ny < 0 || ny >= view.tiles.length / BOARD_WIDTH) {
        continue;
      }
      const tile = view.tiles[tileIndex(nx, ny)];
      let stepCost: number;
      let nextSpent = bridgeSpent;
      if (tile.terrain === "water") {
        // Only a bridge holder, bridge still in hand, stepping from
        // land — one water tile per route, like the engine enforces.
        if (!piece.hasBridge || bridgeSpent || currentTerrain === "water") {
          continue;
        }
        stepCost = WATER_CROSS_COST;
        nextSpent = true;
      } else {
        stepCost = TERRAIN_INFO[tile.terrain].costToEnter;
      }
      if (blocked.has(`${nx},${ny}`)) continue;
      const nextKey = nextSpent ? `${nx},${ny},spent` : `${nx},${ny}`;
      const nd = d + stepCost;
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
 * Cheapest route for `pieceId` to its owner's goal row. Thin wrapper
 * over findPath.
 */
export function findPathToGoal(
  view: GameState,
  pieceId: string,
): CpuPath | null {
  const piece = view.pieces.find((p) => p.id === pieceId);
  if (!piece || piece.status !== "active") return null;
  const goalY = GOAL_ROW[piece.owner];
  return findPath(view, pieceId, (pos) => pos.y === goalY);
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
 * Spoiler mode: the opponent needs one more score and we need at least
 * two, so racing is hopeless — the only winning move is disruption.
 * (When both need one, it's a straight race: keep racing.)
 */
export function isSpoilerMode(view: GameState, player: PlayerId): boolean {
  return piecesToWin(view, otherPlayer(player)) === 1 && piecesToWin(view, player) > 1;
}

/**
 * One spoiler step for `player`: intercept the most imminent threat.
 * Finds the enemy piece fewest steps from scoring, then routes our
 * fastest piece onto that piece's path — standing on it forces the
 * threat to detour around the blocker. Among block candidates: cheapest
 * interception first, then the tile earliest on the threat's path (sooner
 * block), then tiles not adjacent to an enemy piece (don't feed the
 * opponent's nerf). The first step must be legal right now, as usual.
 * Returns null when no interception is possible — the caller falls back
 * to racing.
 */
export function chooseSpoilerStep(
  view: GameState,
  player: PlayerId,
  rng: () => number = Math.random,
): CpuStep | null {
  if (view.phase !== "playing" || view.currentPlayer !== player) return null;
  const foe = otherPlayer(player);

  let threat: CpuPath | null = null;
  for (const piece of view.pieces) {
    if (piece.owner !== foe || piece.status !== "active") continue;
    const path = findPathToGoal(view, piece.id);
    if (!path || path.steps.length === 0) continue;
    if (!threat || path.steps.length < threat.steps.length) threat = path;
  }
  if (!threat) return null;
  const threatTiles = new Set(threat.steps.map(posKey));
  const threatIndexOf = (pos: Position): number =>
    threat!.steps.findIndex((s) => s.x === pos.x && s.y === pos.y);

  const foePositions = view.pieces
    .filter((p) => p.owner === foe && p.status === "active")
    .map((p) => p.position);
  const adjacentToFoe = (pos: Position): boolean =>
    foePositions.some(
      (fp) => Math.abs(fp.x - pos.x) + Math.abs(fp.y - pos.y) === 1,
    );

  const bids: {
    pieceId: string;
    step: Position;
    cost: number;
    threatIndex: number;
    exposed: boolean;
  }[] = [];
  for (const piece of view.pieces) {
    if (piece.owner !== player || piece.status !== "active") continue;
    const intercept = findPath(
      view,
      piece.id,
      (pos) => threatTiles.has(posKey(pos)),
    );
    if (!intercept || intercept.steps.length === 0) continue;
    const [first] = intercept.steps;
    if (
      !legalStepTargets(view, piece.id).some(
        (t) => t.x === first.x && t.y === first.y,
      )
    ) {
      continue;
    }
    const target = intercept.steps[intercept.steps.length - 1];
    bids.push({
      pieceId: piece.id,
      step: first,
      cost: intercept.totalCost,
      threatIndex: threatIndexOf(target),
      exposed: adjacentToFoe(target),
    });
  }

  if (bids.length === 0) return null;
  bids.sort(
    (a, b) =>
      a.cost - b.cost ||
      a.threatIndex - b.threatIndex ||
      Number(a.exposed) - Number(b.exposed),
  );
  const best = bids[0];
  const tied = bids.filter(
    (b) =>
      b.cost === best.cost &&
      b.threatIndex === best.threatIndex &&
      b.exposed === best.exposed,
  );
  const pick = tied[Math.floor(rng() * tied.length)];
  return { pieceId: pick.pieceId, to: pick.step };
}

/**
 * One nerf-hunting step for `player`: when holding a token but no target
 * is adjacent yet, manufacture the nerf — route one of our pieces to a
 * tile adjacent to one of the opponent's most advanced runners, so the
 * nerf-first check in chooseCpuAction fires later this same turn.
 *
 * Targets are the opponent's two most advanced runners (fewest rows from
 * scoring), most advanced first — in spoiler mode only the single most
 * advanced, so a hunt never spends the pool a last-ditch interception
 * needs. A hunt only counts when it can finish this turn: the hunter's
 * whole route must fit its remaining per-piece cap and leave
 * NERF_POOL_COST in the pool for the nerf itself. Among hunters for a
 * target, cheapest route wins, rng breaks ties. One score from winning,
 * the CPU doesn't hunt at all — it races. Returns null when no hunt is
 * viable.
 */
export function chooseNerfHuntStep(
  view: GameState,
  player: PlayerId,
  rng: () => number = Math.random,
): CpuStep | null {
  if (view.phase !== "playing" || view.currentPlayer !== player) return null;
  if (view.nerfTokens[player] < 1) return null;
  if (piecesToWin(view, player) <= 1) return null;
  const foe = otherPlayer(player);
  const foeGoalY = GOAL_ROW[foe];

  const targets = view.pieces
    .filter((p) => p.owner === foe && p.status === "active")
    .sort(
      (a, b) =>
        Math.abs(a.position.y - foeGoalY) - Math.abs(b.position.y - foeGoalY),
    )
    .slice(0, isSpoilerMode(view, player) ? 1 : 2);

  for (const target of targets) {
    const bids: { pieceId: string; step: Position; cost: number }[] = [];
    for (const hunter of view.pieces) {
      if (hunter.owner !== player || hunter.status !== "active") continue;
      const path = findPath(
        view,
        hunter.id,
        (pos) =>
          Math.abs(pos.x - target.position.x) +
            Math.abs(pos.y - target.position.y) ===
          1,
      );
      if (!path || path.steps.length === 0) continue;
      if (path.totalCost > view.movementPointsLeft - NERF_POOL_COST) continue;
      if (
        (view.spentThisTurn[hunter.id] ?? 0) + path.totalCost >
        MAX_POINTS_PER_PIECE_PER_TURN
      ) {
        continue;
      }
      const [first] = path.steps;
      if (
        !legalStepTargets(view, hunter.id).some(
          (t) => t.x === first.x && t.y === first.y,
        )
      ) {
        continue;
      }
      bids.push({ pieceId: hunter.id, step: first, cost: path.totalCost });
    }
    if (bids.length === 0) continue;
    bids.sort((a, b) => a.cost - b.cost);
    const best = bids[0];
    const tied = bids.filter((b) => b.cost === best.cost);
    const pick = tied[Math.floor(rng() * tied.length)];
    return { pieceId: pick.pieceId, to: pick.step };
  }
  return null;
}

/**
 * Choose one action for `player` from their sanitized view, in priority
 * order:
 *   1. Nerf first (NERF_SPEC.md §8): when holding a token with pool to
 *      spend, eliminate the valid target closest to scoring (the most
 *      advanced enemy runner).
 *   2. Pickup power use (PICKUP_POWERS_SPEC.md §CPU hook): a held power
 *      that is usable now — a trap on the enemy runner's path, or a
 *      terraform that shortens the player's own best route. It sits
 *      below the nerf (certain) and above movement (speculative).
 *   3. Nerf hunting: holding a token but nothing adjacent yet — route a
 *      piece next to a top runner so the nerf fires later this turn.
 *      Elimination beats interception, so this outranks spoiler mode.
 *   4. Spoiler mode: when the opponent needs one more score and we need
 *      at least two, race is hopeless — intercept the most imminent
 *      threat's path instead of advancing.
 *   5. Otherwise take the best pathfinding step.
 * Returns null when there's nothing legal to do, which is the page's cue
 * to end the turn.
 */

/**
 * The cheapest goal route among `player`'s active pieces, from their
 * sanitized view: lowest total cost, then fewest steps, then a random
 * pick among ties — the same selection chooseCpuStep makes. No legality
 * filter: this is a route evaluation (whose path is best?), not a step,
 * so the per-piece cap and the pool don't apply. Returns null when no
 * piece has a route.
 */
function bestRunnerPath(
  view: GameState,
  player: PlayerId,
  rng: () => number,
): CpuPath | null {
  const candidates: CpuPath[] = [];
  for (const piece of view.pieces) {
    if (piece.owner !== player || piece.status !== "active") continue;
    const path = findPathToGoal(view, piece.id);
    if (path) candidates.push(path);
  }
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) => a.totalCost - b.totalCost || a.steps.length - b.steps.length,
  );
  const best = candidates[0];
  const tied = candidates.filter(
    (p) =>
      p.totalCost === best.totalCost && p.steps.length === best.steps.length,
  );
  return tied[Math.floor(rng() * tied.length)];
}

/** A copy of `view` with one tile's terrain replaced (route probing). */
function withTileTerrain(
  view: GameState,
  position: Position,
  terrain: TerrainType,
): GameState {
  const tiles = [...view.tiles];
  tiles[tileIndex(position.x, position.y)] = {
    ...tiles[tileIndex(position.x, position.y)],
    terrain,
  };
  return { ...view, tiles };
}

/**
 * Where `player` should put a held trap power: on the enemy best
 * runner's path, a few steps ahead of the runner. Scan order: from the
 * third step ahead to the goal, then back toward the runner, then the
 * nearest legal tile to the path (or to the runner, when the path is
 * empty because it already stands on the goal row). Returns null when no
 * legal tile exists (the power then expires).
 */
function chooseTrapTarget(
  view: GameState,
  player: PlayerId,
  enemyPath: CpuPath,
): Position | null {
  const steps = enemyPath.steps;
  const start = steps.length === 0 ? 0 : Math.min(2, steps.length - 1);
  for (let i = start; i < steps.length; i++) {
    if (canPlacePickupTrap(view, player, steps[i]).ok) return steps[i];
  }
  for (let i = start - 1; i >= 0; i--) {
    if (canPlacePickupTrap(view, player, steps[i]).ok) return steps[i];
  }
  const runner = view.pieces.find((p) => p.id === enemyPath.pieceId);
  const anchors = steps.length > 0 ? steps : runner ? [runner.position] : [];
  let best: Position | null = null;
  let bestDist = Infinity;
  for (const tile of view.tiles) {
    const pos = tile.position;
    if (!canPlacePickupTrap(view, player, pos).ok) continue;
    const d = Math.min(
      ...anchors.map((a) => Math.abs(a.x - pos.x) + Math.abs(a.y - pos.y)),
    );
    if (d < bestDist) {
      bestDist = d;
      best = pos;
    }
  }
  return best;
}

/**
 * Where `player` should put a held terraform power: the single tile
 * whose terraforming most reduces the player's best runner's route cost.
 * Compares the runner's real cheapest route against an optimistic one
 * where every water/forest tile costs 1 (as if already terraformed);
 * when the optimistic route is cheaper, each water/forest tile on it is
 * verified by recomputing the real route with just that tile terraformed,
 * and the biggest verified saving wins. Returns null when no tile helps
 * (the power then expires).
 */
function chooseTerraformTarget(
  view: GameState,
  player: PlayerId,
  ownPath: CpuPath,
): Position | null {
  const optimistic: GameState = {
    ...view,
    tiles: view.tiles.map((tile) =>
      tile.terrain === "plains"
        ? tile
        : { ...tile, terrain: "plains" as const },
    ),
  };
  const optPath = findPathToGoal(optimistic, ownPath.pieceId);
  if (!optPath || optPath.totalCost >= ownPath.totalCost) return null;
  const seen = new Set<string>();
  let best: Position | null = null;
  let bestSaving = 0;
  for (const pos of optPath.steps) {
    const key = posKey(pos);
    if (seen.has(key)) continue;
    seen.add(key);
    if (view.tiles[tileIndex(pos.x, pos.y)].terrain === "plains") continue;
    if (!canTerraform(view, player, pos).ok) continue;
    const newPath = findPathToGoal(
      withTileTerrain(view, pos, "plains"),
      ownPath.pieceId,
    );
    if (!newPath) continue;
    const saving = ownPath.totalCost - newPath.totalCost;
    if (saving > bestSaving) {
      bestSaving = saving;
      best = pos;
    }
  }
  return best;
}

/**
 * A held pickup power use for `player`, from their sanitized view — the
 * CPU-use hook (PICKUP_POWERS_SPEC.md §CPU hook). Checked every tick, so
 * a power collected mid-turn is used on the next tick while the pool
 * still covers it; anything unusable expires at endTurn as usual.
 * Priority is the caller's business: chooseCpuAction and chooseHardAction
 * both check this after the nerf branch, so a certain elimination still
 * outranks a speculative trap. A trap goes on the enemy best runner's
 * path — predicted from a trap-blind view, because the enemy does not
 * know our hidden traps and routing it around them (as the raw view
 * would) predicts a detour it will never take. A terraform only fires
 * when it provably shortens the player's own best route. Returns null
 * when the player holds nothing usable.
 */
export function choosePickupPowerAction(
  view: GameState,
  player: PlayerId,
  rng: () => number = Math.random,
): CpuAction | null {
  if (view.phase !== "playing" || view.currentPlayer !== player) return null;
  if (view.movementPointsLeft < PICKUP_POWER_COST) return null;
  const foe = otherPlayer(player);
  for (const power of view.heldPowers[player]) {
    if (power === "trap") {
      // The enemy's true path ignores our hidden traps.
      const blind: GameState = {
        ...view,
        traps: view.traps.filter((t) => t.owner === foe),
      };
      const foePath = bestRunnerPath(blind, foe, rng);
      if (!foePath) continue;
      const target = chooseTrapTarget(view, player, foePath);
      if (target) {
        return { kind: "use-pickup", power: "trap", position: target };
      }
    } else {
      const ownPath = bestRunnerPath(view, player, rng);
      if (!ownPath) continue;
      const target = chooseTerraformTarget(view, player, ownPath);
      if (target) {
        return { kind: "use-pickup", power: "terraform", position: target };
      }
    }
  }
  return null;
}

export function chooseCpuAction(
  view: GameState,
  player: PlayerId,
  rng: () => number = Math.random,
): CpuAction | null {
  if (view.phase !== "playing" || view.currentPlayer !== player) return null;

  const targets = nerfTargets(view, player);
  if (targets.length > 0) {
    const foeGoalY = GOAL_ROW[otherPlayer(player)];
    let best = targets[0];
    for (const target of targets) {
      if (
        Math.abs(target.position.y - foeGoalY) <
        Math.abs(best.position.y - foeGoalY)
      ) {
        best = target;
      }
    }
    return { kind: "nerf", targetPieceId: best.id };
  }

  const power = choosePickupPowerAction(view, player, rng);
  if (power) return power;

  const hunt = chooseNerfHuntStep(view, player, rng);
  if (hunt) return { kind: "step", ...hunt };

  if (isSpoilerMode(view, player)) {
    const spoiler = chooseSpoilerStep(view, player, rng);
    if (spoiler) return { kind: "step", ...spoiler };
  }

  const step = chooseCpuStep(view, player, rng);
  return step ? { kind: "step", ...step } : null;
}
