import { describe, expect, it } from "vitest";

import {
  chooseCpuAction,
  chooseCpuStep,
  chooseNerfHuntStep,
  chooseSpoilerStep,
  findPath,
  findPathToGoal,
  isSpoilerMode,
  piecesToWin,
  sanitizeForPlayer,
} from "./cpu";
import { scenarioGame } from "./test-helpers";
import type { GameState, Piece, PlayerId } from "./types";

// Phase 1e (TEST_PLAN.md): CPU pathfinding and action priority — plus
// the sanitization rule every decision depends on. States here use a
// minimal piece set (only the pieces the decision involves) on an
// all-plains board, so routes are fully determined by the test.

function piece(
  id: string,
  owner: PlayerId,
  x: number,
  y: number,
  patch: Partial<Piece> = {},
): Piece {
  return {
    id,
    character: "cat",
    owner,
    position: { x, y },
    status: "active",
    hasBridge: false,
    hasTrapSense: false,
    ...patch,
  };
}

function cpuGame(pieces: Piece[], patch: Partial<GameState> = {}): GameState {
  const base = scenarioGame();
  return {
    ...base,
    tiles: base.tiles.map((t) => ({ ...t, terrain: "plains" as const })),
    pieces,
    traps: [],
    phase: "playing",
    currentPlayer: "north",
    movementPointsLeft: 10,
    spentThisTurn: {},
    bonusPoints: {},
    scores: { north: 0, south: 0 },
    nerfTokens: { north: 0, south: 0 },
    nerfTokensPending: { north: 0, south: 0 },
    revealedTraps: { north: [], south: [] },
    ...patch,
  };
}

const CAT = (x: number, y: number, patch: Partial<Piece> = {}) =>
  piece("north-cat", "north", x, y, patch);

describe("sanitizeForPlayer", () => {
  it("removes unrevealed opponent traps but keeps own, triggered, and revealed ones", () => {
    const state = {
      ...cpuGame([CAT(5, 5)]),
      traps: [
        { owner: "north" as const, position: { x: 5, y: 6 }, triggered: false },
        { owner: "south" as const, position: { x: 6, y: 6 }, triggered: false },
        { owner: "south" as const, position: { x: 7, y: 7 }, triggered: true },
        { owner: "south" as const, position: { x: 8, y: 8 }, triggered: false },
      ],
      revealedTraps: { north: [{ x: 8, y: 8 }], south: [] },
    };
    const view = sanitizeForPlayer(state, "north");
    expect(view.traps.map((t) => `${t.position.x},${t.position.y}`).sort()).toEqual([
      "5,6",
      "7,7",
      "8,8",
    ]);
    // The opponent's revealed set is itself private.
    expect(view.revealedTraps).toEqual({ north: [{ x: 8, y: 8 }], south: [] });
  });
});

describe("findPath", () => {
  it("routes straight down a plains column with the summed cost", () => {
    const state = cpuGame([CAT(10, 10)]);
    const path = findPath(state, "north-cat", (pos) => pos.y === 20);
    expect(path).not.toBeNull();
    expect(path!.steps).toEqual(
      Array.from({ length: 10 }, (_, i) => ({ x: 10, y: 11 + i })),
    );
    expect(path!.totalCost).toBe(10);
  });

  it("charges terrain costs along the route", () => {
    let state = cpuGame([CAT(10, 10)]);
    state = {
      ...state,
      tiles: state.tiles.map((t) =>
        t.position.x === 10 && t.position.y === 12
          ? { ...t, terrain: "forest" as const }
          : t,
      ),
    };
    const path = findPath(state, "north-cat", (pos) => pos.y === 13);
    expect(path!.totalCost).toBe(4); // plains + forest + plains
    expect(path!.steps).toEqual([
      { x: 10, y: 11 },
      { x: 10, y: 12 },
      { x: 10, y: 13 },
    ]);
  });

  it("detours around occupied tiles", () => {
    const state = cpuGame([
      CAT(10, 10),
      piece("south-cat", "south", 10, 15),
    ]);
    const path = findPath(state, "north-cat", (pos) => pos.y === 20);
    expect(path!.steps).not.toContainEqual({ x: 10, y: 15 });
    // A predicate goal accepts any tile on the row, not necessarily x = 10,
    // so the detour ends at (11, 20): 10 straight steps + 1 sideways = 11.
    expect(path!.steps[path!.steps.length - 1].y).toBe(20);
    expect(path!.totalCost).toBe(11);
  });

  it("returns null when a water wall seals the board", () => {
    let state = cpuGame([CAT(10, 10)]);
    state = {
      ...state,
      tiles: state.tiles.map((t) =>
        t.position.y === 15 ? { ...t, terrain: "water" as const } : t,
      ),
    };
    expect(findPath(state, "north-cat", (pos) => pos.y === 20)).toBeNull();
  });

  it("crosses one water tile with a bridge, never two", () => {
    let state = cpuGame([CAT(10, 10, { hasBridge: true })]);
    state = {
      ...state,
      tiles: state.tiles.map((t) =>
        t.position.x === 10 && t.position.y === 15
          ? { ...t, terrain: "water" as const }
          : t,
      ),
    };
    const crossed = findPath(state, "north-cat", (pos) => pos.y === 20);
    expect(crossed!.steps).toContainEqual({ x: 10, y: 15 });
    expect(crossed!.totalCost).toBe(10); // 9 plains + 1 water crossing
    // Two adjacent water tiles: the route uses the bridge at most once.
    state = {
      ...state,
      tiles: state.tiles.map((t) =>
        t.position.x === 10 && (t.position.y === 14 || t.position.y === 15)
          ? { ...t, terrain: "water" as const }
          : t,
      ),
    };
    const detour = findPath(state, "north-cat", (pos) => pos.y === 20);
    const waterSteps = detour!.steps.filter(
      (s) => s.x === 10 && (s.y === 14 || s.y === 15),
    );
    expect(waterSteps.length).toBeLessThanOrEqual(1);
    expect(detour!.steps[detour!.steps.length - 1].y).toBe(20);
  });

  it("treats revealed traps as walls and unrevealed ones as invisible", () => {
    const trap = { owner: "south" as const, position: { x: 10, y: 15 }, triggered: false };
    const revealed = sanitizeForPlayer(
      { ...cpuGame([CAT(10, 10)]), traps: [trap], revealedTraps: { north: [{ x: 10, y: 15 }], south: [] } },
      "north",
    );
    const detour = findPath(revealed, "north-cat", (pos) => pos.y === 20);
    expect(detour!.steps).not.toContainEqual({ x: 10, y: 15 });
    const blind = sanitizeForPlayer(
      { ...cpuGame([CAT(10, 10)]), traps: [trap] },
      "north",
    );
    const straight = findPath(blind, "north-cat", (pos) => pos.y === 20);
    expect(straight!.steps).toContainEqual({ x: 10, y: 15 });
  });

  it("walks straight through the viewer's own traps", () => {
    const state = cpuGame([CAT(10, 10)], {
      traps: [{ owner: "north", position: { x: 10, y: 15 }, triggered: false }],
    });
    const path = findPath(state, "north-cat", (pos) => pos.y === 20);
    expect(path!.steps).toContainEqual({ x: 10, y: 15 });
  });

  it("returns null for unknown or inactive pieces", () => {
    const state = cpuGame([CAT(10, 10)]);
    expect(findPath(state, "north-nope", (pos) => pos.y === 20)).toBeNull();
    const inactive = cpuGame([CAT(10, 10, { status: "eliminated" })]);
    expect(findPath(inactive, "north-cat", (pos) => pos.y === 20)).toBeNull();
  });

  it("returns an empty route when already on a goal tile", () => {
    const state = cpuGame([CAT(10, 20)]);
    const path = findPath(state, "north-cat", (pos) => pos.y === 20);
    expect(path).toEqual({ pieceId: "north-cat", steps: [], totalCost: 0 });
  });
});

describe("findPathToGoal", () => {
  it("routes north to y = 30 and south to y = 0", () => {
    const north = cpuGame([CAT(10, 10)]);
    expect(findPathToGoal(north, "north-cat")!.steps.at(-1)).toEqual({
      x: 10,
      y: 30,
    });
    const south = cpuGame([piece("south-cat", "south", 10, 20)], {
      currentPlayer: "south",
    });
    expect(findPathToGoal(south, "south-cat")!.steps.at(-1)).toEqual({
      x: 10,
      y: 0,
    });
  });
});

describe("chooseCpuStep", () => {
  it("takes the first step of the cheapest route", () => {
    const state = cpuGame([
      CAT(10, 10),
      piece("north-dog", "north", 10, 25),
    ]);
    expect(chooseCpuStep(state, "north", () => 0)).toEqual({
      pieceId: "north-dog",
      to: { x: 10, y: 26 },
    });
  });

  it("returns null with nothing legal: wrong phase, wrong turn, spent pool, capped pieces", () => {
    const state = cpuGame([CAT(10, 10)]);
    expect(
      chooseCpuStep({ ...state, phase: "setup" }, "north", () => 0),
    ).toBeNull();
    expect(
      chooseCpuStep({ ...state, currentPlayer: "south" }, "north", () => 0),
    ).toBeNull();
    expect(
      chooseCpuStep({ ...state, movementPointsLeft: 0 }, "north", () => 0),
    ).toBeNull();
    expect(
      chooseCpuStep(
        { ...state, spentThisTurn: { "north-cat": 3 } },
        "north",
        () => 0,
      ),
    ).toBeNull();
  });
});

describe("piecesToWin and isSpoilerMode", () => {
  it("counts down from 5", () => {
    expect(piecesToWin(cpuGame([]), "north")).toBe(5);
    expect(
      piecesToWin(cpuGame([], { scores: { north: 3, south: 0 } }), "north"),
    ).toBe(2);
  });

  it("is spoiler mode exactly when the foe needs 1 and we need 2+", () => {
    const mode = cpuGame([], {
      scores: { north: 3, south: 4 },
    });
    expect(isSpoilerMode(mode, "north")).toBe(true);
    const race = cpuGame([], {
      scores: { north: 4, south: 4 },
    });
    expect(isSpoilerMode(race, "north")).toBe(false);
    const comfortable = cpuGame([], {
      scores: { north: 0, south: 3 },
    });
    expect(isSpoilerMode(comfortable, "north")).toBe(false);
  });
});

describe("chooseSpoilerStep", () => {
  it("routes the fastest piece onto the most imminent threat's path", () => {
    // The hunter sits in the threat's own column's neighbour, so the
    // shortest interception is unique — no Dijkstra tie-breaking in
    // the asserted first step.
    const state = cpuGame(
      [
        CAT(11, 5),
        piece("south-cat", "south", 10, 2),
        piece("south-dog", "south", 5, 25),
      ],
      { scores: { north: 0, south: 4 } },
    );
    expect(chooseSpoilerStep(state, "north", () => 0)).toEqual({
      pieceId: "north-cat",
      to: { x: 11, y: 4 },
    });
  });

  it("returns null with no threat or no turn", () => {
    const state = cpuGame([CAT(10, 5)]);
    expect(chooseSpoilerStep(state, "north", () => 0)).toBeNull();
    const wrongTurn = cpuGame([CAT(10, 5)], { currentPlayer: "south" });
    expect(chooseSpoilerStep(wrongTurn, "north", () => 0)).toBeNull();
  });
});

describe("chooseNerfHuntStep", () => {
  it("routes a piece adjacent to the most advanced runner", () => {
    const state = cpuGame(
      [
        CAT(10, 10),
        piece("south-cat", "south", 10, 12),
        piece("south-dog", "south", 5, 25),
      ],
      { nerfTokens: { north: 1, south: 0 } },
    );
    expect(chooseNerfHuntStep(state, "north", () => 0)).toEqual({
      pieceId: "north-cat",
      to: { x: 10, y: 11 },
    });
  });

  it("returns null without a token, when one from winning, or when the pool cannot fund the nerf", () => {
    const base = cpuGame(
      [CAT(10, 10), piece("south-cat", "south", 10, 12)],
      { nerfTokens: { north: 1, south: 0 } },
    );
    expect(
      chooseNerfHuntStep(
        { ...base, nerfTokens: { north: 0, south: 0 } },
        "north",
        () => 0,
      ),
    ).toBeNull();
    expect(
      chooseNerfHuntStep(
        { ...base, scores: { north: 4, south: 0 } },
        "north",
        () => 0,
      ),
    ).toBeNull();
    // Hunt costs 1 but must leave 3 in the pool for the nerf itself.
    expect(
      chooseNerfHuntStep({ ...base, movementPointsLeft: 3 }, "north", () => 0),
    ).toBeNull();
    // A capped hunter cannot hunt either.
    expect(
      chooseNerfHuntStep(
        { ...base, spentThisTurn: { "north-cat": 3 } },
        "north",
        () => 0,
      ),
    ).toBeNull();
  });
});

describe("chooseCpuAction priority", () => {
  it("nerfs first, even in spoiler mode", () => {
    const state = cpuGame(
      [
        CAT(10, 10),
        piece("south-cat", "south", 10, 11),
      ],
      {
        nerfTokens: { north: 1, south: 0 },
        scores: { north: 0, south: 4 },
      },
    );
    expect(chooseCpuAction(state, "north", () => 0)).toEqual({
      kind: "nerf",
      targetPieceId: "south-cat",
    });
  });

  it("nerfs the target closest to the foe goal row", () => {
    const state = cpuGame(
      [
        CAT(10, 10),
        piece("south-cat", "south", 10, 11),
        piece("south-dog", "south", 11, 10),
      ],
      { nerfTokens: { north: 1, south: 0 } },
    );
    // South scores at y = 0: the dog at y = 10 is more advanced.
    expect(chooseCpuAction(state, "north", () => 0)).toEqual({
      kind: "nerf",
      targetPieceId: "south-dog",
    });
  });

  it("hunts second when holding a token with nothing adjacent", () => {
    const state = cpuGame(
      [
        CAT(10, 10),
        piece("south-cat", "south", 10, 12),
      ],
      { nerfTokens: { north: 1, south: 0 } },
    );
    expect(chooseCpuAction(state, "north", () => 0)).toEqual({
      kind: "step",
      pieceId: "north-cat",
      to: { x: 10, y: 11 },
    });
  });

  it("spoils third in spoiler mode without a token", () => {
    const state = cpuGame(
      [
        CAT(11, 5),
        piece("south-cat", "south", 10, 2),
      ],
      { scores: { north: 0, south: 4 } },
    );
    expect(chooseCpuAction(state, "north", () => 0)).toEqual({
      kind: "step",
      pieceId: "north-cat",
      to: { x: 11, y: 4 },
    });
  });

  it("races otherwise, and returns null with nothing legal", () => {
    const race = cpuGame([CAT(10, 10)]);
    expect(chooseCpuAction(race, "north", () => 0)).toEqual({
      kind: "step",
      pieceId: "north-cat",
      to: { x: 10, y: 11 },
    });
    const stuck = cpuGame([CAT(10, 10)], { movementPointsLeft: 0 });
    expect(chooseCpuAction(stuck, "north", () => 0)).toBeNull();
  });
});
