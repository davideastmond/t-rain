import { describe, expect, it } from "vitest";

import { boxCollector } from "../game/boxes";
import { setTerrain } from "../game/test-helpers";
import type { GameState, PlayerId, Position } from "../game/types";
import type { GameStartEvent, MoveEvent } from "./log";
import { battleStep, createBattle } from "./runner";

// Battle-log shield events (POWERUPS_SPEC.md §7): a shield collection
// logs as a box outcome, and a shield-blocked trap logs as a trap event
// with pieceEliminated: false. The tests inject a stub strategy — the
// same probe pattern the lab uses for old strategy versions — because a
// real strategy chooses from its sanitized view and would never aim at
// a box or a trap it cannot see.

const samePos = (a: Position, b: Position) => a.x === b.x && a.y === b.y;

/**
 * Teleport one of `player`'s pieces next to `target` (on a plains tile)
 * and set the turn up for a single step onto it. Returns the staged
 * state and the piece id.
 */
function stageStepOnto(
  state: GameState,
  player: PlayerId,
  target: Position,
): { state: GameState; pieceId: string } {
  const piece = state.pieces.find(
    (p) => p.owner === player && p.status === "active",
  )!;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const from = { x: target.x + dx, y: target.y + dy };
    if (from.x < 0 || from.x >= 30 || from.y < 0 || from.y >= 31) continue;
    if (
      state.pieces.some(
        (p) => p.status === "active" && samePos(p.position, from),
      )
    ) {
      continue;
    }
    let next = setTerrain(state, from.x, from.y, "plains");
    next = setTerrain(next, target.x, target.y, "plains");
    next = {
      ...next,
      pieces: next.pieces.map((p) =>
        p.id === piece.id ? { ...p, position: from } : p,
      ),
      currentPlayer: player,
      movementPointsLeft: 10,
      spentThisTurn: {},
      pickups: [],
    };
    return { state: next, pieceId: piece.id };
  }
  throw new Error("stageStepOnto: no free neighbor");
}

describe("shield collection in battleStep", () => {
  it("logs the shield box outcome, arms the piece, and records the tunable", () => {
    const driver = createBattle(0, "full", "full");
    const player = driver.state.currentPlayer;
    // Seed 0, roll #7 → 0.880, in the shield band.
    const box = driver.state.mysteryBoxes.find(
      (b) => boxCollector(b.position) === player,
    )!;
    const { state, pieceId } = stageStepOnto(driver.state, player, box.position);
    driver.state = { ...state, boxRolls: 7 };
    driver.strategies[player] = {
      id: "stub",
      version: "stub@v1",
      label: "Stub",
      choose: () => ({ kind: "step", pieceId, to: box.position }),
    };
    const { narrations } = battleStep(driver);
    const move = driver.log.all.find((e) => e.type === "move") as MoveEvent;
    expect(move.events).toContainEqual({ kind: "box", outcome: "shield" });
    expect(
      driver.state.pieces.find((p) => p.id === pieceId)?.hasShield,
    ).toBe(true);
    expect(narrations.join(" ")).toContain("shield");
    const start = driver.log.all[0] as GameStartEvent;
    expect(start.tunables.boxShieldChance).toBe(0.1);
  });
});

describe("shield-blocked trap in battleStep", () => {
  it("logs the trap with pieceEliminated: false and narrates the shield", () => {
    const driver = createBattle(0, "full", "full");
    const player = driver.state.currentPlayer;
    const trap = driver.state.traps.find(
      (t) => t.owner !== player && !t.triggered,
    )!;
    const staged = stageStepOnto(driver.state, player, trap.position);
    driver.state = {
      ...staged.state,
      pieces: staged.state.pieces.map((p) =>
        p.id === staged.pieceId ? { ...p, hasShield: true } : p,
      ),
    };
    driver.strategies[player] = {
      id: "stub",
      version: "stub@v1",
      label: "Stub",
      choose: () => ({
        kind: "step",
        pieceId: staged.pieceId,
        to: trap.position,
      }),
    };
    const { narrations } = battleStep(driver);
    const move = driver.log.all.find((e) => e.type === "move") as MoveEvent;
    expect(move.events).toContainEqual({
      kind: "trap",
      pos: [trap.position.x, trap.position.y],
      pieceEliminated: false,
    });
    const piece = driver.state.pieces.find((p) => p.id === staged.pieceId)!;
    expect(piece.status).toBe("active");
    expect(piece.hasShield).toBe(false);
    expect(
      driver.state.traps.find((t) => samePos(t.position, trap.position))
        ?.triggered,
    ).toBe(true);
    expect(narrations.join(" ")).toContain("shield");
  });
});
