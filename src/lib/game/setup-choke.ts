// Choke-point trap setup (HARD_CPU_PHASE2_SPEC.md §1).
//
// The ranking is a path count over the terrain-only land graph: for
// each passable tile in the invader's back 3 rows, the Dijkstra
// shortest path (terrain costs, water blocked — the same machinery as
// `findPath`) to the defender's goal row, and a tile's choke score is
// how many of those paths pass through it. Cut vertices need no
// separate machinery: they rank first automatically, because every
// path passes through them.
//
// Terrain-only is deliberate: it is deterministic, cheap (≤90 sources
// over 930 tiles, once per game at setup — never per tick), and it
// uses only public board information, the same information a human has
// at setup. Pieces are placed randomly, exactly as `autoPlaceSetup`
// does, so any measured edge comes from traps alone.

import { tileIndex } from "./board";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  GOAL_ROW,
  SETUP_ROWS,
  TRAPS_PER_PLAYER,
} from "./constants";
import { createSeededRng } from "./rng";
import {
  ALL_CHARACTERS,
  applySetup,
  canPlaceTrapAt,
  isInPieceZone,
  isInTrapZone,
  type ApplySetupResult,
} from "./setup";
import { otherPlayer } from "./setup";
import { TERRAIN_INFO, type GameState, type PlayerId, type Position } from "./types";

/** Traps taken from the top of the choke ranking (tunable). */
export const CHOKE_TRAPS = 6;
/** Goal-row traps added beyond any the choke fill already placed. */
export const CHOKE_GOAL_TRAPS = 2;

function key(pos: Position): string {
  return `${pos.x},${pos.y}`;
}

/** Dijkstra shortest path over the terrain-only graph to any tile on
    `goalY`, or null when unreachable. Path includes both endpoints. */
function shortestPathToRow(
  state: GameState,
  from: Position,
  goalY: number,
): Position[] | null {
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const queue: string[] = [];
  dist.set(key(from), 0);
  queue.push(key(from));
  const DIRS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  while (queue.length > 0) {
    // Stable sort keeps insertion order among equal distances, so
    // ties resolve deterministically (the engine's findPath order).
    queue.sort((a, b) => dist.get(a)! - dist.get(b)!);
    const cur = queue.shift()!;
    const [cx, cy] = cur.split(",").map(Number);
    if (cy === goalY) {
      const path: Position[] = [];
      let k: string | undefined = cur;
      while (k !== undefined) {
        const [x, y] = k.split(",").map(Number);
        path.push({ x, y });
        k = prev.get(k);
      }
      return path.reverse();
    }
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= BOARD_WIDTH || ny < 0 || ny >= BOARD_HEIGHT) continue;
      const tile = state.tiles[tileIndex(nx, ny)];
      if (!TERRAIN_INFO[tile.terrain].passable) continue;
      const nk = `${nx},${ny}`;
      const nd = dist.get(cur)! + TERRAIN_INFO[tile.terrain].costToEnter;
      if (nd < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nd);
        prev.set(nk, cur);
        if (!queue.includes(nk)) queue.push(nk);
      }
    }
  }
  return null;
}

/**
 * Choke score per tile for `defender`: how many shortest paths from
 * the invader's back rows to the defender's goal row pass through it.
 * Tiles never on a path are absent (score 0).
 */
export function chokeScores(
  state: GameState,
  defender: PlayerId,
): Map<string, number> {
  const invader = otherPlayer(defender);
  const goalY = GOAL_ROW[invader];
  const scores = new Map<string, number>();
  const backRows =
    invader === "north"
      ? [0, 1, 2]
      : [BOARD_HEIGHT - SETUP_ROWS, BOARD_HEIGHT - SETUP_ROWS + 1, BOARD_HEIGHT - 1];
  for (const tile of state.tiles) {
    if (!backRows.includes(tile.position.y)) continue;
    if (!TERRAIN_INFO[tile.terrain].passable) continue;
    const path = shortestPathToRow(state, tile.position, goalY);
    if (!path) continue;
    for (const pos of path) {
      const k = key(pos);
      scores.set(k, (scores.get(k) ?? 0) + 1);
    }
  }
  return scores;
}

/**
 * Choke-point setup: random pieces (as `autoPlaceSetup`), traps by
 * ordered fill — CHOKE_TRAPS from the choke ranking, then
 * CHOKE_GOAL_TRAPS goal-row tiles, then random spread until the quota
 * is full. Submitted through `applySetup`, so every existing check
 * (zone, water, boxes, piece overlap, neutral cap) still applies.
 * Deterministic: same seed, same placement.
 */
export function chooseChokeSetup(
  state: GameState,
  player: PlayerId,
): ApplySetupResult {
  const rng = createSeededRng(state.seed + (player === "north" ? 101 : 202));

  function shuffled<T>(items: T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  // Pieces first, exactly as autoPlaceSetup (same rng stream order).
  const pieceCandidates = shuffled(
    state.tiles
      .filter(
        (tile) =>
          isInPieceZone(player, tile.position) &&
          TERRAIN_INFO[tile.terrain].passable,
      )
      .map((tile) => tile.position),
  );
  const piecePlacements = ALL_CHARACTERS.map((character, i) => ({
    character,
    position: pieceCandidates[i],
  }));
  const pieceKeys = new Set(piecePlacements.map((p) => key(p.position)));

  // Traps: shuffle first so ranking ties resolve by the setup rng
  // (stable sort below keeps shuffled order among equal scores).
  const scores = chokeScores(state, player);
  const zoneTiles = shuffled(
    state.tiles.filter(
      (tile) =>
        isInTrapZone(player, tile.position) &&
        TERRAIN_INFO[tile.terrain].passable &&
        !pieceKeys.has(key(tile.position)),
    ),
  );
  const ranked = [...zoneTiles].sort(
    (a, b) => (scores.get(key(b.position)) ?? 0) - (scores.get(key(a.position)) ?? 0),
  );

  const traps: Position[] = [];
  const tryAdd = (pos: Position): boolean => {
    if (traps.length >= TRAPS_PER_PLAYER) return false;
    if (!canPlaceTrapAt(state, player, pos, traps).ok) return false;
    traps.push(pos);
    return true;
  };

  let accepted = 0;
  for (const tile of ranked) {
    if (accepted >= CHOKE_TRAPS) break;
    if (tryAdd(tile.position)) accepted++;
  }
  const goalY = GOAL_ROW[otherPlayer(player)];
  accepted = 0;
  for (const tile of ranked) {
    if (tile.position.y !== goalY) continue;
    if (accepted >= CHOKE_GOAL_TRAPS) break;
    if (tryAdd(tile.position)) accepted++;
  }
  for (const tile of zoneTiles) {
    if (traps.length >= TRAPS_PER_PLAYER) break;
    tryAdd(tile.position);
  }

  return applySetup(state, player, piecePlacements, traps);
}
