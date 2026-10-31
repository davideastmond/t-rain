import { describe, expect, it } from "vitest";

import { sanitizeForPlayer } from "./cpu";
import { endTurn, movePieceStep } from "./movement";
import {
  applyPickupTrap,
  applyTerraform,
  canPlacePickupTrap,
  canTerraform,
  placePickup,
} from "./pickups";
import {
  addTrap,
  movePieceTo,
  scenarioGame,
  setTerrain,
} from "./test-helpers";
import type { GameState } from "./types";

// Phase 1 (PICKUP_POWERS_SPEC.md): placement, collection, the two powers,
// same-turn expiry, and sanitization. Wiring (pages, routes, CPU use,
// battle logs) comes in later phases — these tests cover the engine.

/**
 * North to move, north-cat on plains at (10,10), (10,11) pinned plains.
 * Boxes cleared: seed-42 box positions are irrelevant here and must not
 * interfere with pickup targets.
 */
function powerState(): GameState {
  return {
    ...setTerrain(
      setTerrain(
        movePieceTo(scenarioGame(), "north-cat", { x: 10, y: 10 }),
        10,
        10,
        "plains",
      ),
      10,
      11,
      "plains",
    ),
    mysteryBoxes: [],
  };
}

function withHeld(state: GameState, kind: "trap" | "terraform"): GameState {
  return {
    ...state,
    heldPowers: { north: [kind], south: [] },
  };
}

describe("placePickup", () => {
  it("places exactly one pickup on a legal tile", () => {
    const { state, placed } = placePickup(scenarioGame(), () => 0);
    expect(placed).toBe(true);
    expect(state.pickups).toHaveLength(1);
    const [pickup] = state.pickups;
    const tile =
      state.tiles[pickup.position.y * 30 + pickup.position.x];
    expect(["plains", "forest"]).toContain(tile.terrain);
    expect(
      (pickup.position.y >= 3 && pickup.position.y <= 14) ||
        (pickup.position.y >= 16 && pickup.position.y <= 27),
    ).toBe(true);
    expect(pickup.position.y).not.toBe(15);
    expect(
      state.mysteryBoxes.some(
        (box) =>
          box.position.x === pickup.position.x &&
          box.position.y === pickup.position.y,
      ),
    ).toBe(false);
    expect(
      state.pieces.some(
        (piece) =>
          piece.status === "active" &&
          piece.position.x === pickup.position.x &&
          piece.position.y === pickup.position.y,
      ),
    ).toBe(false);
  });

  it("takes the kind from the rng stream", () => {
    expect(placePickup(scenarioGame(), () => 0).state.pickups[0].kind).toBe(
      "trap",
    );
    expect(
      placePickup(scenarioGame(), () => 0.999).state.pickups[0].kind,
    ).toBe("terraform");
  });

  it("is deterministic for a fixed rng stream", () => {
    const a = placePickup(scenarioGame(), () => 0.42).state.pickups;
    const b = placePickup(scenarioGame(), () => 0.42).state.pickups;
    expect(a).toEqual(b);
  });

  it("skips trap tiles when choosing", () => {
    // Only two legal tiles exist: (5,10) holds a trap, so the pickup
    // must land on (7,12).
    let state = scenarioGame();
    state = {
      ...state,
      mysteryBoxes: [],
      tiles: state.tiles.map((tile) => {
        const { x, y } = tile.position;
        if (y >= 3 && y <= 27 && !(x === 5 && y === 10) && !(x === 7 && y === 12)) {
          return { ...tile, terrain: "water" as const };
        }
        return tile;
      }),
    };
    state = setTerrain(setTerrain(state, 5, 10, "plains"), 7, 12, "plains");
    state = addTrap(state, "south", { x: 5, y: 10 });
    const { state: placed, placed: ok } = placePickup(state, () => 0);
    expect(ok).toBe(true);
    expect(placed.pickups[0].position).toEqual({ x: 7, y: 12 });
  });

  it("refuses when not playing, already placed, or nowhere legal", () => {
    expect(
      placePickup({ ...scenarioGame(), phase: "setup" as const }, () => 0)
        .placed,
    ).toBe(false);
    const withPickup = placePickup(scenarioGame(), () => 0).state;
    expect(placePickup(withPickup, () => 0).placed).toBe(false);
    const allWater = {
      ...scenarioGame(),
      tiles: scenarioGame().tiles.map((tile) => ({
        ...tile,
        terrain: "water" as const,
      })),
    };
    expect(placePickup(allWater, () => 0).placed).toBe(false);
  });
});

describe("collection via movePieceStep", () => {
  it("collects the pickup on entry and holds the power", () => {
    const state = {
      ...powerState(),
      pickups: [{ position: { x: 10, y: 11 }, kind: "trap" as const }],
    };
    const result = movePieceStep(state, "north-cat", { x: 10, y: 11 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.pickup).toBe("trap");
    expect(result.state.pickups).toEqual([]);
    expect(result.state.heldPowers.north).toEqual(["trap"]);
    expect(
      result.state.pieces.find((p) => p.id === "north-cat")?.status,
    ).toBe("active");
  });

  it("does not collect when the step is trapped", () => {
    const state = addTrap(
      {
        ...powerState(),
        pickups: [{ position: { x: 10, y: 11 }, kind: "trap" as const }],
      },
      "south",
      { x: 10, y: 11 },
    );
    const result = movePieceStep(state, "north-cat", { x: 10, y: 11 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.eliminated).toBe(true);
    expect(result.outcome.pickup).toBeNull();
    expect(result.state.pickups).toHaveLength(1);
  });
});

describe("applyPickupTrap", () => {
  it("rejects invalid uses", () => {
    const held = withHeld(powerState(), "trap");
    expect(
      applyPickupTrap({ ...held, phase: "setup" as const }, "north", {
        x: 12,
        y: 12,
      }),
    ).toEqual({ ok: false, error: "wrong-phase" });
    expect(applyPickupTrap(held, "south", { x: 12, y: 12 })).toEqual({
      ok: false,
      error: "not-your-turn",
    });
    expect(applyPickupTrap(powerState(), "north", { x: 12, y: 12 })).toEqual({
      ok: false,
      error: "no-power",
    });
    expect(
      applyPickupTrap({ ...held, movementPointsLeft: 2 }, "north", {
        x: 12,
        y: 12,
      }),
    ).toEqual({ ok: false, error: "insufficient-points" });
    expect(applyPickupTrap(held, "north", { x: 10, y: 10 })).toEqual({
      ok: false,
      error: "invalid-target",
    });
    const trapped = addTrap(held, "south", { x: 12, y: 12 });
    expect(applyPickupTrap(trapped, "north", { x: 12, y: 12 })).toEqual({
      ok: false,
      error: "invalid-target",
    });
    const boxed = {
      ...held,
      mysteryBoxes: [{ position: { x: 12, y: 12 }, collected: false }],
    };
    expect(applyPickupTrap(boxed, "north", { x: 12, y: 12 })).toEqual({
      ok: false,
      error: "invalid-target",
    });
    expect(canPlacePickupTrap(held, "north", { x: -1, y: 12 })).toEqual({
      ok: false,
      error: "invalid-target",
    });
  });

  it("places the trap, spends the power and the pool, bypassing the cap", () => {
    let held = withHeld(powerState(), "trap");
    for (let x = 0; x < 10; x++) {
      held = addTrap(held, "north", { x, y: 5 });
    }
    const result = applyPickupTrap(held, "north", { x: 12, y: 12 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.traps).toHaveLength(11);
    expect(result.state.traps[10]).toEqual({
      owner: "north",
      position: { x: 12, y: 12 },
      triggered: false,
    });
    expect(result.state.heldPowers.north).toEqual([]);
    expect(result.state.movementPointsLeft).toBe(7);
  });

  it("allows water and goal-row targets", () => {
    const held = withHeld(powerState(), "trap");
    const water = setTerrain(held, 12, 12, "water");
    expect(applyPickupTrap(water, "north", { x: 12, y: 12 }).ok).toBe(true);
    expect(applyPickupTrap(held, "north", { x: 5, y: 30 }).ok).toBe(true);
  });
});

describe("applyTerraform", () => {
  it("rejects invalid uses", () => {
    const held = withHeld(powerState(), "terraform");
    expect(
      applyTerraform({ ...held, phase: "setup" as const }, "north", {
        x: 12,
        y: 12,
      }),
    ).toEqual({ ok: false, error: "wrong-phase" });
    expect(applyTerraform(held, "south", { x: 12, y: 12 })).toEqual({
      ok: false,
      error: "not-your-turn",
    });
    expect(applyTerraform(powerState(), "north", { x: 12, y: 12 })).toEqual({
      ok: false,
      error: "no-power",
    });
    expect(
      applyTerraform({ ...held, movementPointsLeft: 2 }, "north", {
        x: 12,
        y: 12,
      }),
    ).toEqual({ ok: false, error: "insufficient-points" });
    expect(applyTerraform(held, "north", { x: 10, y: 10 })).toEqual({
      ok: false,
      error: "invalid-target",
    });
    expect(canTerraform(held, "north", { x: 99, y: 12 })).toEqual({
      ok: false,
      error: "invalid-target",
    });
  });

  it("turns water and forest into plains, spending power and pool", () => {
    const held = withHeld(powerState(), "terraform");
    const water = applyTerraform(setTerrain(held, 12, 12, "water"), "north", {
      x: 12,
      y: 12,
    });
    expect(water.ok).toBe(true);
    if (!water.ok) return;
    expect(water.state.tiles[12 * 30 + 12].terrain).toBe("plains");
    expect(water.state.heldPowers.north).toEqual([]);
    expect(water.state.movementPointsLeft).toBe(7);
    const forest = applyTerraform(
      setTerrain(held, 12, 12, "forest"),
      "north",
      { x: 12, y: 12 },
    );
    expect(forest.ok).toBe(true);
    if (!forest.ok) return;
    expect(forest.state.tiles[12 * 30 + 12].terrain).toBe("plains");
  });

  it("leaves a trap or piece on the tile unaffected", () => {
    const held = withHeld(powerState(), "terraform");
    const trapped = addTrap(setTerrain(held, 12, 12, "forest"), "south", {
      x: 12,
      y: 12,
    });
    const result = applyTerraform(trapped, "north", { x: 12, y: 12 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.tiles[12 * 30 + 12].terrain).toBe("plains");
    expect(result.state.traps).toHaveLength(1);
    expect(result.state.traps[0].triggered).toBe(false);
    const occupied = movePieceTo(
      setTerrain(held, 12, 12, "forest"),
      "south-dog",
      { x: 12, y: 12 },
    );
    const moved = applyTerraform(occupied, "north", { x: 12, y: 12 });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(
      moved.state.pieces.find((p) => p.id === "south-dog")?.position,
    ).toEqual({ x: 12, y: 12 });
    expect(
      moved.state.pieces.find((p) => p.id === "south-dog")?.status,
    ).toBe("active");
  });
});

describe("same-turn expiry and sanitization", () => {
  it("endTurn clears only the ending player's held powers", () => {
    const state = {
      ...scenarioGame(),
      heldPowers: { north: ["trap" as const], south: ["terraform" as const] },
    };
    const afterNorth = endTurn({ ...state, currentPlayer: "north" });
    expect(afterNorth.ok).toBe(true);
    if (!afterNorth.ok) return;
    expect(afterNorth.state.heldPowers).toEqual({
      north: [],
      south: ["terraform"],
    });
    const afterSouth = endTurn({
      ...afterNorth.state,
      currentPlayer: "south",
    });
    expect(afterSouth.ok).toBe(true);
    if (!afterSouth.ok) return;
    expect(afterSouth.state.heldPowers).toEqual({ north: [], south: [] });
  });

  it("sanitizeForPlayer hides pickups and the opponent's held powers", () => {
    const state = {
      ...scenarioGame(),
      pickups: [{ position: { x: 10, y: 11 }, kind: "trap" as const }],
      heldPowers: { north: ["trap" as const], south: ["terraform" as const] },
    };
    const view = sanitizeForPlayer(state, "north");
    expect(view.pickups).toEqual([]);
    expect(view.heldPowers).toEqual({ north: ["trap"], south: [] });
  });

  it("a finished view reveals everything", () => {
    const state = {
      ...scenarioGame(),
      phase: "finished" as const,
      pickups: [{ position: { x: 10, y: 11 }, kind: "trap" as const }],
      heldPowers: { north: ["trap" as const], south: ["terraform" as const] },
    };
    const view = sanitizeForPlayer(state, "north");
    expect(view.pickups).toHaveLength(1);
    expect(view.heldPowers).toEqual({
      north: ["trap"],
      south: ["terraform"],
    });
  });
});
