// Choke-point setup tests (HARD_CPU_PHASE2_SPEC.md §1). The synthetic
// board makes the ranking exact: a water wall across the neutral row
// with a single gap forces every invader path through that gap.
import { describe, expect, it } from "vitest";

import { createGame, isInTrapZone } from "./setup";
import { CHOKE_GOAL_TRAPS, CHOKE_TRAPS, chokeScores, chooseChokeSetup } from "./setup-choke";
import { TERRAIN_INFO } from "./types";

function syntheticWallState() {
  const base = createGame(42);
  const tiles = base.tiles.map((t) => ({
    ...t,
    terrain:
      t.position.y === 15 && t.position.x !== 10
        ? ("water" as const)
        : ("plains" as const),
  }));
  return { ...base, tiles, traps: [], pieces: [], mysteryBoxes: [] };
}

describe("chokeScores", () => {
  it("gives the single neutral gap every invader path", () => {
    const scores = chokeScores(syntheticWallState(), "north");
    // Invader south has 90 passable back-row tiles, and the gap is the
    // only neutral-row tile any path can cross.
    expect(scores.get("10,15")).toBe(90);
    expect(scores.get("0,15") ?? 0).toBe(0);
  });
});

describe("chooseChokeSetup", () => {
  it("places a legal, deterministic setup with top-ranked traps", () => {
    const state = createGame(42);
    const first = chooseChokeSetup(state, "north");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.state.pieces.filter((p) => p.owner === "north")).toHaveLength(15);
    const traps = first.state.traps.filter((t) => t.owner === "north");
    expect(traps).toHaveLength(10);
    expect(traps.filter((t) => t.position.y === 15).length).toBeLessThanOrEqual(3);
    // No trap on water, on a box, or on a piece tile.
    const tileOf = new Map(
      first.state.tiles.map((t) => [`${t.position.x},${t.position.y}`, t]),
    );
    const pieceKeys = new Set(
      first.state.pieces.map((p) => `${p.position.x},${p.position.y}`),
    );
    for (const trap of traps) {
      const k = `${trap.position.x},${trap.position.y}`;
      expect(TERRAIN_INFO[tileOf.get(k)!.terrain].passable).toBe(true);
      expect(pieceKeys.has(k)).toBe(false);
      expect(
        first.state.mysteryBoxes.some(
          (b) => b.position.x === trap.position.x && b.position.y === trap.position.y,
        ),
      ).toBe(false);
    }
    // Top-ranked trap-zone tiles are actually used.
    const scores = chokeScores(state, "north");
    const ranked = state.tiles
      .filter(
        (t) =>
          isInTrapZone("north", t.position) &&
          TERRAIN_INFO[t.terrain].passable &&
          !pieceKeys.has(`${t.position.x},${t.position.y}`),
      )
      .sort(
        (a, b) =>
          (scores.get(`${b.position.x},${b.position.y}`) ?? 0) -
          (scores.get(`${a.position.x},${a.position.y}`) ?? 0),
      )
      .slice(0, 10)
      .map((t) => `${t.position.x},${t.position.y}`);
    const trapKeys = new Set(
      traps.map((t) => `${t.position.x},${t.position.y}`),
    );
    expect(ranked.some((k) => trapKeys.has(k))).toBe(true);
    // Deterministic: same seed, same placement.
    const second = chooseChokeSetup(state, "north");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(
      second.state.traps
        .filter((t) => t.owner === "north")
        .map((t) => `${t.position.x},${t.position.y}`),
    ).toEqual(
      traps.map((t) => `${t.position.x},${t.position.y}`),
    );
    expect(CHOKE_TRAPS).toBe(6);
    expect(CHOKE_GOAL_TRAPS).toBe(2);
  });
});
