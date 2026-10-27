import { describe, expect, it } from "vitest";

import { applyNerf, canNerf, nerfTargets } from "./nerf";
import { addTrap, movePieceTo, scenarioGame } from "./test-helpers";

// Phase 1b (TEST_PLAN.md): nerf rules — validation order, targeting,
// costs, attrition, and the fact that nerfing is not movement.

const CAT = "north-cat";

/** North to move, one token, full pool, south-cat adjacent to north-cat. */
function nerfState() {
  return {
    ...movePieceTo(
      movePieceTo(scenarioGame(), CAT, { x: 10, y: 10 }),
      "south-cat",
      { x: 10, y: 11 },
    ),
    nerfTokens: { north: 1, south: 0 },
  };
}

describe("canNerf", () => {
  it("rejects nerfs when the game is not playing", () => {
    const state = { ...nerfState(), phase: "setup" as const };
    expect(canNerf(state, "north", "south-cat")).toEqual({
      ok: false,
      error: "wrong-phase",
    });
  });

  it("rejects nerfs from the player who is not moving", () => {
    expect(canNerf(nerfState(), "south", "south-cat")).toEqual({
      ok: false,
      error: "not-your-turn",
    });
  });

  it("rejects nerfs without a token", () => {
    const state = { ...nerfState(), nerfTokens: { north: 0, south: 0 } };
    expect(canNerf(state, "north", "south-cat")).toEqual({
      ok: false,
      error: "no-token",
    });
  });

  it("rejects nerfs the pool cannot pay", () => {
    const state = { ...nerfState(), movementPointsLeft: 2 };
    expect(canNerf(state, "north", "south-cat")).toEqual({
      ok: false,
      error: "insufficient-points",
    });
  });

  it("rejects invalid targets: unknown, inactive, own, or out of range", () => {
    const state = nerfState();
    expect(canNerf(state, "north", "south-nope")).toEqual({
      ok: false,
      error: "invalid-target",
    });
    const inactive = movePieceTo(state, "south-cat", { x: 10, y: 11 }, {
      status: "eliminated",
    });
    expect(canNerf(inactive, "north", "south-cat")).toEqual({
      ok: false,
      error: "invalid-target",
    });
    expect(canNerf(state, "north", "north-dog")).toEqual({
      ok: false,
      error: "invalid-target",
    });
    const far = movePieceTo(state, "south-cat", { x: 10, y: 15 });
    expect(canNerf(far, "north", "south-cat")).toEqual({
      ok: false,
      error: "invalid-target",
    });
  });

  it("allows an adjacent active enemy piece", () => {
    expect(canNerf(nerfState(), "north", "south-cat")).toEqual({ ok: true });
  });
});

describe("nerfTargets", () => {
  it("returns exactly the adjacent active enemy pieces", () => {
    let state = nerfState();
    // Three more neighbours of (10, 10): two valid targets, one own piece.
    state = movePieceTo(state, "south-dog", { x: 11, y: 10 });
    state = movePieceTo(state, "south-horse", { x: 10, y: 9 });
    state = movePieceTo(state, "north-dog", { x: 9, y: 10 });
    // An inactive adjacent enemy and a distant enemy are not targets.
    state = movePieceTo(state, "south-mouse", { x: 10, y: 11 }, {
      status: "eliminated",
    });
    expect(nerfTargets(state, "north").map((p) => p.id).sort()).toEqual([
      "south-cat",
      "south-dog",
      "south-horse",
    ]);
  });

  it("agrees with canNerf on every enemy piece", () => {
    const state = nerfState();
    const targets = new Set(nerfTargets(state, "north").map((p) => p.id));
    for (const piece of state.pieces.filter((p) => p.owner === "south")) {
      expect(canNerf(state, "north", piece.id).ok).toBe(
        targets.has(piece.id),
      );
    }
  });

  it("is empty when the player cannot nerf at all", () => {
    const noToken = { ...nerfState(), nerfTokens: { north: 0, south: 0 } };
    expect(nerfTargets(noToken, "north")).toEqual([]);
    expect(nerfTargets(nerfState(), "south")).toEqual([]);
    const poor = { ...nerfState(), movementPointsLeft: 2 };
    expect(nerfTargets(poor, "north")).toEqual([]);
  });
});

describe("applyNerf", () => {
  it("eliminates the target for 1 token + 3 pool points, turn continues", () => {
    const state = nerfState();
    const result = applyNerf(state, "north", "south-cat");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toEqual({
      eliminatedPieceId: "south-cat",
      attritionLoss: false,
    });
    expect(
      result.state.pieces.find((p) => p.id === "south-cat")?.status,
    ).toBe("eliminated");
    expect(result.state.nerfTokens.north).toBe(0);
    expect(result.state.movementPointsLeft).toBe(7);
    expect(result.state.phase).toBe("playing");
    expect(result.state.currentPlayer).toBe("north");
    // Pure: the input state is untouched.
    expect(state.nerfTokens.north).toBe(1);
    expect(state.movementPointsLeft).toBe(10);
  });

  it("allows multiple nerfs per turn while tokens and pool last", () => {
    let state = {
      ...movePieceTo(
        movePieceTo(nerfState(), "south-dog", { x: 11, y: 10 }),
        CAT,
        { x: 10, y: 10 },
      ),
      nerfTokens: { north: 2, south: 0 },
    };
    const first = applyNerf(state, "north", "south-cat");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    state = first.state;
    const second = applyNerf(state, "north", "south-dog");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.state.nerfTokens.north).toBe(0);
    expect(second.state.movementPointsLeft).toBe(4);
  });

  it("ends the game by attrition when the target's owner drops below 5 able", () => {
    let state = nerfState();
    state = {
      ...state,
      pieces: state.pieces.map((p) =>
        p.owner === "south" && p.id !== "south-cat"
          ? { ...p, status: "eliminated" as const }
          : p,
      ),
    };
    const result = applyNerf(state, "north", "south-cat");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.attritionLoss).toBe(true);
    expect(result.state.phase).toBe("finished");
    expect(result.state.winner).toBe("north");
  });

  it("is not movement: traps under the target do not block it", () => {
    const state = addTrap(nerfState(), "north", { x: 10, y: 11 });
    const result = applyNerf(state, "north", "south-cat");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.eliminatedPieceId).toBe("south-cat");
  });
});
