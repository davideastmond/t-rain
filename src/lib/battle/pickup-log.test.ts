import { describe, expect, it } from "vitest";
import type {
  GameStartEvent,
  MoveEvent,
  PickupPlaceEvent,
  PickupUseEvent,
} from "./log";
import { battleStep, createBattle, runBattleGame } from "./runner";
import { setTerrain } from "../game/test-helpers";
import type {
  GameState,
  PickupPowerKind,
  PlayerId,
  Position,
} from "../game/types";

// Battle-log pickup events (PICKUP_POWERS_SPEC.md §11): placement at the
// setup→playing flip, collection as a move outcome, use as its own
// event. The step/use tests inject a stub strategy — the same probe
// pattern the lab uses for old strategy versions — because a real
// strategy chooses from its sanitized view and would never aim at a
// pickup it cannot see.

const samePos = (a: Position, b: Position) => a.x === b.x && a.y === b.y;

function heldFor(
  player: PlayerId,
  kind: PickupPowerKind,
): Record<PlayerId, PickupPowerKind[]> {
  return {
    north: player === "north" ? [kind] : [],
    south: player === "south" ? [kind] : [],
  };
}

/** A free tile adjacent to one of `player`'s pieces, for a forced step. */
function freeNeighbor(
  state: GameState,
  player: PlayerId,
): { pieceId: string; to: Position } {
  const occupied = new Set(
    state.pieces
      .filter((p) => p.status === "active")
      .map((p) => `${p.position.x},${p.position.y}`),
  );
  for (const piece of state.pieces) {
    if (piece.owner !== player || piece.status !== "active") continue;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const to = { x: piece.position.x + dx, y: piece.position.y + dy };
      if (to.x < 0 || to.x >= 30 || to.y < 0 || to.y >= 31) continue;
      if (occupied.has(`${to.x},${to.y}`)) continue;
      return { pieceId: piece.id, to };
    }
  }
  throw new Error("freeNeighbor: no free adjacent tile");
}

describe("pickup placement in createBattle", () => {
  it("places exactly one legal pickup and logs it after the setups", () => {
    const driver = createBattle(123, "full", "full");
    expect(driver.state.pickups).toHaveLength(1);
    const [pickup] = driver.state.pickups;
    const tile =
      driver.state.tiles[pickup.position.y * 30 + pickup.position.x];
    expect(["plains", "forest"]).toContain(tile.terrain);
    expect(
      (pickup.position.y >= 3 && pickup.position.y <= 14) ||
        (pickup.position.y >= 16 && pickup.position.y <= 27),
    ).toBe(true);
    expect(pickup.position.y).not.toBe(15);
    expect(
      driver.state.pieces.some(
        (p) => p.status === "active" && samePos(p.position, pickup.position),
      ),
    ).toBe(false);
    expect(
      driver.state.traps.some((t) => samePos(t.position, pickup.position)),
    ).toBe(false);
    expect(
      driver.state.mysteryBoxes.some((b) =>
        samePos(b.position, pickup.position),
      ),
    ).toBe(false);

    const events = driver.log.all;
    expect(events[0].type).toBe("game_start");
    expect(events[1].type).toBe("setup");
    expect(events[2].type).toBe("setup");
    const place = events[3] as PickupPlaceEvent;
    expect(place.type).toBe("pickup_place");
    expect(place.position).toEqual([pickup.position.x, pickup.position.y]);
    expect(place.kind).toBe(pickup.kind);

    const start = events[0] as GameStartEvent;
    expect(start.tunables.pickupPowerCost).toBe(3);
  });

  it("places the same pickup for the same seed", () => {
    const a = createBattle(123, "full", "full");
    const b = createBattle(123, "full", "full");
    expect(a.state.pickups).toEqual(b.state.pickups);
    const placeA = a.log.all.find((e) => e.type === "pickup_place");
    const placeB = b.log.all.find((e) => e.type === "pickup_place");
    expect(placeA).toEqual(placeB);
  });

  it("places nothing when replaying a pre-pickup log", () => {
    const driver = createBattle(123, "full", "full", { pickups: false });
    expect(driver.state.pickups).toEqual([]);
    expect(
      driver.log.all.some((e) => e.type === "pickup_place"),
    ).toBe(false);
  });
});

describe("pickup collection in battleStep", () => {
  it("logs the pickup in the move event and grants the held power", () => {
    const driver = createBattle(123, "full", "full");
    const player = driver.state.currentPlayer;
    const { pieceId, to } = freeNeighbor(driver.state, player);
    let state = setTerrain(driver.state, to.x, to.y, "plains");
    state = {
      ...state,
      currentPlayer: player,
      movementPointsLeft: 10,
      spentThisTurn: {},
      traps: state.traps.filter((t) => !samePos(t.position, to)),
      mysteryBoxes: state.mysteryBoxes.filter((b) => !samePos(b.position, to)),
      pickups: [{ position: to, kind: "terraform" }],
    };
    driver.state = state;
    driver.strategies[player] = {
      id: "stub",
      version: "stub@v1",
      label: "Stub",
      choose: () => ({ kind: "step", pieceId, to }),
    };
    const { narrations } = battleStep(driver);
    const move = driver.log.all.find((e) => e.type === "move") as MoveEvent;
    expect(move.events).toContainEqual({
      kind: "pickup",
      power: "terraform",
    });
    expect(driver.state.heldPowers[player]).toEqual(["terraform"]);
    expect(narrations.join(" ")).toContain("pickup");
  });
});

describe("pickup use in battleStep", () => {
  it("logs pickup_use and places the trap", () => {
    const driver = createBattle(123, "full", "full");
    const player = driver.state.currentPlayer;
    const target = driver.state.tiles.find(
      (t) =>
        t.terrain === "plains" &&
        !driver.state.pieces.some(
          (p) => p.status === "active" && samePos(p.position, t.position),
        ) &&
        !driver.state.traps.some((trap) => samePos(trap.position, t.position)) &&
        !driver.state.mysteryBoxes.some((b) =>
          samePos(b.position, t.position),
        ),
    )!.position;
    driver.state = {
      ...driver.state,
      currentPlayer: player,
      movementPointsLeft: 10,
      spentThisTurn: {},
      heldPowers: heldFor(player, "trap"),
    };
    driver.strategies[player] = {
      id: "stub",
      version: "stub@v1",
      label: "Stub",
      choose: () => ({ kind: "use-pickup", power: "trap", position: target }),
    };
    const { narrations } = battleStep(driver);
    const use = driver.log.all.find(
      (e) => e.type === "pickup_use",
    ) as PickupUseEvent;
    expect(use).toMatchObject({
      player,
      power: "trap",
      position: [target.x, target.y],
    });
    expect(
      driver.state.traps.some(
        (t) => t.owner === player && samePos(t.position, target),
      ),
    ).toBe(true);
    expect(driver.state.heldPowers[player]).toEqual([]);
    expect(narrations.join(" ")).toContain("extra trap");
  });

  it("logs pickup_use and terraforms the tile", () => {
    const driver = createBattle(123, "full", "full");
    const player = driver.state.currentPlayer;
    const target = driver.state.tiles.find(
      (t) => t.terrain === "water",
    )!.position;
    driver.state = {
      ...driver.state,
      currentPlayer: player,
      movementPointsLeft: 10,
      spentThisTurn: {},
      heldPowers: heldFor(player, "terraform"),
    };
    driver.strategies[player] = {
      id: "stub",
      version: "stub@v1",
      label: "Stub",
      choose: () => ({
        kind: "use-pickup",
        power: "terraform",
        position: target,
      }),
    };
    battleStep(driver);
    const use = driver.log.all.find(
      (e) => e.type === "pickup_use",
    ) as PickupUseEvent;
    expect(use).toMatchObject({
      player,
      power: "terraform",
      position: [target.x, target.y],
    });
    expect(
      driver.state.tiles[target.y * 30 + target.x].terrain,
    ).toBe("plains");
  });
});

describe("full games with pickups in play", () => {
  it("terminates and logs a pickup_place", () => {
    const result = runBattleGame(42, "full", "full", { maxTurns: 15 });
    expect(result.turns).toBeLessThanOrEqual(15);
    expect(
      result.log.all.some((e) => e.type === "pickup_place"),
    ).toBe(true);
  }, 30000);
});
