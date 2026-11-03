import { describe, expect, it } from "vitest";
import { getStrategy } from "../battle/strategies";
import { BOARD_HEIGHT } from "./constants";
import { chooseCpuAction, choosePickupPowerAction } from "./cpu";
import { chooseHardAction } from "./cpu-hard";
import {
  addTrap,
  movePieceTo,
  scenarioGame,
  setTerrain,
} from "./test-helpers";
import type { GameState, PickupPowerKind } from "./types";

// CPU pickup-power use (PICKUP_POWERS_SPEC.md §CPU hook): the CPU is
// North in every fixture. Runners sit in column x = 20, clear of the
// parked rosters (x = 0..14), with the column pinned to plains so the
// cheapest route is the straight column and the asserted tile is exact.
// Boxes are cleared: a box tile is never a legal trap target, and a box
// on the column would shift the scan.

const rng = () => 0;

/** North holds one power, pool full, nothing spent. */
function withPower(
  state: GameState,
  kind: PickupPowerKind,
  pool = 10,
): GameState {
  return {
    ...state,
    mysteryBoxes: [],
    heldPowers: { north: [kind], south: [] },
    movementPointsLeft: pool,
    spentThisTurn: {},
  };
}

/** Pin column x to plains, except one water tile when waterY is given. */
function pinColumn(state: GameState, x: number, waterY?: number): GameState {
  let next = state;
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    next = setTerrain(next, x, y, y === waterY ? "water" : "plains");
  }
  return next;
}

/** South's best runner at (20, 20), straight column to the goal. */
function trapFixture(): GameState {
  let state = scenarioGame(42, "north");
  state = movePieceTo(state, "south-cat", { x: 20, y: 20 });
  state = pinColumn(state, 20);
  return withPower(state, "trap");
}

/** North's best runner at (20, 10), straight column to the goal. */
function terraformFixture(waterY?: number): GameState {
  let state = scenarioGame(42, "north");
  state = movePieceTo(state, "north-cat", { x: 20, y: 10 });
  state = pinColumn(state, 20, waterY);
  return withPower(state, "terraform");
}

describe("choosePickupPowerAction guards", () => {
  it("returns null outside playing, off-turn, broke, or empty-handed", () => {
    const base = trapFixture();
    expect(
      choosePickupPowerAction({ ...base, phase: "setup" }, "north", rng),
    ).toBeNull();
    expect(
      choosePickupPowerAction(
        { ...base, currentPlayer: "south" },
        "north",
        rng,
      ),
    ).toBeNull();
    expect(
      choosePickupPowerAction(
        { ...base, movementPointsLeft: 2 },
        "north",
        rng,
      ),
    ).toBeNull();
    expect(
      choosePickupPowerAction(
        { ...base, heldPowers: { north: [], south: [] } },
        "north",
        rng,
      ),
    ).toBeNull();
  });
});

describe("CPU trap placement", () => {
  it("places on the enemy runner's path, three steps ahead", () => {
    expect(chooseCpuAction(trapFixture(), "north", rng)).toEqual({
      kind: "use-pickup",
      power: "trap",
      position: { x: 20, y: 17 },
    });
  });

  it("predicts the enemy path ignoring our own hidden traps", () => {
    // A north trap sits on the runner's column. The enemy does not know
    // it, so its true path stays straight — and the new trap still lands
    // three steps ahead, not on a detour around our own trap.
    let state = trapFixture();
    state = addTrap(state, "north", { x: 20, y: 18 });
    expect(chooseCpuAction(state, "north", rng)).toEqual({
      kind: "use-pickup",
      power: "trap",
      position: { x: 20, y: 17 },
    });
  });

  it("falls back to the nearest legal tile when the path is full", () => {
    let state = trapFixture();
    for (let y = 0; y < 20; y++) {
      state = addTrap(state, "north", { x: 20, y });
    }
    // Every path tile is taken; the first distance-1 tile in board order
    // is (19, 0), beside the goal end of the path.
    expect(chooseCpuAction(state, "north", rng)).toEqual({
      kind: "use-pickup",
      power: "trap",
      position: { x: 19, y: 0 },
    });
  });

  it("lets the nerf fire before a held power", () => {
    let state = trapFixture();
    // South-cat steps up beside north-cat: an adjacent nerf target.
    state = movePieceTo(state, "south-cat", { x: 0, y: 3 });
    state = { ...state, nerfTokens: { north: 1, south: 0 } };
    expect(chooseCpuAction(state, "north", rng)).toEqual({
      kind: "nerf",
      targetPieceId: "south-cat",
    });
  });
});

describe("CPU terraform placement", () => {
  it("terraformes the water tile blocking the runner's route", () => {
    expect(chooseCpuAction(terraformFixture(20), "north", rng)).toEqual({
      kind: "use-pickup",
      power: "terraform",
      position: { x: 20, y: 20 },
    });
  });

  it("leaves the power unused when no tile helps the route", () => {
    const action = chooseCpuAction(terraformFixture(), "north", rng);
    expect(action?.kind).toBe("step");
  });
});

describe("hard CPU power use", () => {
  it("uses a held power without waiting on lookahead", () => {
    expect(chooseHardAction(trapFixture(), "north", rng)).toEqual({
      kind: "use-pickup",
      power: "trap",
      position: { x: 20, y: 17 },
    });
  });

  it("never spends a power on a tick with a nerf target", () => {
    let state = trapFixture();
    state = movePieceTo(state, "south-cat", { x: 0, y: 3 });
    state = { ...state, nerfTokens: { north: 1, south: 0 } };
    // Hard may nerf or step here (lookahead decides); what it must not
    // do is spend the power while a nerf is on the table.
    expect(chooseHardAction(state, "north", rng)?.kind).not.toBe("use-pickup");
  });
});

describe("strategy versions", () => {
  it("registers full and hard at v5", () => {
    expect(getStrategy("full").version).toBe("full@v5");
    expect(getStrategy("hard").version).toBe("hard@v5");
  });
});
