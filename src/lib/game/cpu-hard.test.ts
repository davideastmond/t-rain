// Phase: Hard CPU v4 (HARD_CPU_PHASE2_SPEC.md §3) — v2's rules plus
// 1-ply lookahead. States are built minimally (a few pieces, pinned
// plains columns) so route costs are exact regardless of the generated
// board: a straight plains column is always the cheapest route for
// its piece.
import { describe, expect, it } from "vitest";

import { getStrategy } from "../battle/strategies";
import { chooseCpuStep } from "./cpu";
import {
  chooseHardAction,
  chooseHardRaceStep,
  chooseScoringStep,
  evaluatePosition,
  HARD_DANGER_COST,
  isDangerTile,
  shouldInterceptHard,
} from "./cpu-hard";
import { createGame } from "./setup";
import type {
  CharacterId,
  GameState,
  Piece,
  PlayerId,
  TerrainType,
} from "./types";

function piece(
  id: string,
  character: CharacterId,
  owner: PlayerId,
  x: number,
  y: number,
): Piece {
  return {
    id,
    character,
    owner,
    position: { x, y },
    status: "active",
    hasBridge: false,
    hasTrapSense: false,
  };
}

function stateWith(
  pieces: Piece[],
  patch: Partial<GameState> = {},
): GameState {
  const base = createGame(42);
  // Pin two plains columns so the test pieces' routes are exact:
  // x=5 rows 0-4 (5 steps to the goal row) and x=10 rows 0-5 (6 steps).
  const pinned = new Set<string>();
  for (let y = 0; y <= 4; y++) pinned.add(`5,${y}`);
  for (let y = 0; y <= 5; y++) pinned.add(`10,${y}`);
  const tiles = base.tiles.map((t) =>
    pinned.has(`${t.position.x},${t.position.y}`)
      ? { ...t, terrain: "plains" as const }
      : t,
  );
  return {
    ...base,
    tiles,
    pieces,
    traps: [],
    phase: "playing",
    currentPlayer: "south",
    movementPointsLeft: 10,
    spentThisTurn: {},
    scores: { north: 0, south: 0 },
    nerfTokens: { north: 0, south: 0 },
    nerfTokensPending: { north: 0, south: 0 },
    ...patch,
  };
}

// South cat at (5,5) has the cheapest route (5), but its first step
// (5,4) sits next to the north cat at (6,4). South dog at (10,6) has a
// 6-step route with a safe first step.
function dangerState(northTokens: number, northPending = 0): GameState {
  return stateWith(
    [
      piece("south-cat", "cat", "south", 5, 5),
      piece("south-dog", "dog", "south", 10, 6),
      piece("north-cat", "cat", "north", 6, 4),
    ],
    {
      nerfTokens: { north: northTokens, south: 0 },
      nerfTokensPending: { north: northPending, south: 0 },
    },
  );
}

describe("isDangerTile", () => {
  it("flags a tile next to a token-holding enemy, and only then", () => {
    const armed = dangerState(1);
    expect(isDangerTile(armed, "south", { x: 5, y: 4 })).toBe(true);
    expect(isDangerTile(armed, "south", { x: 10, y: 5 })).toBe(false);
    expect(isDangerTile(dangerState(0), "south", { x: 5, y: 4 })).toBe(false);
    // Pending tokens are not usable yet, so they create no danger.
    expect(isDangerTile(dangerState(0, 1), "south", { x: 5, y: 4 })).toBe(false);
  });
});

describe("chooseHardRaceStep", () => {
  it("pays the danger penalty and picks the safe piece over the cheap one", () => {
    const state = dangerState(1);
    // Plain full picks the cat (route 5 < 6); hard sees 5 + 2 > 6.
    expect(chooseCpuStep(state, "south")?.pieceId).toBe("south-cat");
    expect(chooseHardRaceStep(state, "south")).toEqual({
      pieceId: "south-dog",
      to: { x: 10, y: 5 },
    });
    expect(HARD_DANGER_COST).toBe(2);
  });

  it("reduces to plain racing when the enemy holds no usable token", () => {
    const state = dangerState(0);
    expect(chooseHardRaceStep(state, "south")?.pieceId).toBe("south-cat");
    expect(chooseHardRaceStep(state, "south")).toEqual(
      chooseCpuStep(state, "south"),
    );
  });

  it("still steps when the dangerous route is the only route", () => {
    const state = stateWith([piece("south-cat", "cat", "south", 5, 5)], {
      nerfTokens: { north: 1, south: 0 },
    });
    // No second piece at all: penalty is a cost, not a wall.
    const step = chooseHardRaceStep(
      {
        ...state,
        pieces: [
          piece("south-cat", "cat", "south", 5, 5),
          piece("north-cat", "cat", "north", 6, 4),
        ],
      },
      "south",
    );
    expect(step).toEqual({ pieceId: "south-cat", to: { x: 5, y: 4 } });
  });

  it("returns null when it is not that player's turn", () => {
    const state = dangerState(1);
    expect(chooseHardRaceStep({ ...state, currentPlayer: "north" }, "south")).toBeNull();
  });
});

describe("chooseHardAction", () => {
  it("nerfs when a target is adjacent, like full", () => {
    const state = stateWith(
      [
        piece("south-cat", "cat", "south", 5, 5),
        piece("north-cat", "cat", "north", 5, 4),
      ],
      { nerfTokens: { north: 0, south: 1 } },
    );
    expect(chooseHardAction(state, "south")).toEqual({
      kind: "nerf",
      targetPieceId: "north-cat",
    });
  });

  it("races danger-aware when there is nothing better to do", () => {
    const state = dangerState(1);
    const action = chooseHardAction(state, "south");
    expect(action).toEqual({
      kind: "step",
      pieceId: "south-dog",
      to: { x: 10, y: 5 },
    });
  });
});

describe("hard strategy registration", () => {
  it("is registered as hard@v4", () => {
    expect(getStrategy("hard").version).toBe("hard@v4");
  });
});

// Override tiles in a state: pins is a list of [x, y, terrain].
function pinTiles(
  state: GameState,
  pins: Array<[number, number, TerrainType]>,
): GameState {
  const pinMap = new Map(pins.map(([x, y, t]) => [`${x},${y}`, t]));
  return {
    ...state,
    tiles: state.tiles.map((t) => {
      const terrain = pinMap.get(`${t.position.x},${t.position.y}`);
      return terrain ? { ...t, terrain } : t;
    }),
  };
}

function columnState(
  pieces: Piece[],
  patch: Partial<GameState> = {},
): GameState {
  // Pin the whole x=10 column to plains so every route on it is a
  // straight column with an exact step count.
  const pins: Array<[number, number, TerrainType]> = [];
  for (let y = 0; y <= 30; y++) pins.push([10, y, "plains"]);
  return pinTiles(stateWith(pieces, patch), pins);
}

describe("chooseScoringStep", () => {
  // South scorer at (5,1) with the goal tile (5,0) pinned plains, a
  // south hunter at (11,11) holding a token, and a north runner at
  // (12,12) the hunt would chase (dog's route to (11,12) costs 1).
  function scoreVsHuntState(): GameState {
    return pinTiles(
      stateWith(
        [
          piece("south-cat", "cat", "south", 5, 1),
          piece("south-dog", "dog", "south", 11, 11),
          piece("north-cat", "cat", "north", 12, 12),
        ],
        { nerfTokens: { north: 0, south: 1 } },
      ),
      [
        [5, 0, "plains"],
        [11, 12, "plains"],
        [12, 11, "water"],
      ],
    );
  }

  it("takes the scoring step before a live nerf hunt", () => {
    const state = scoreVsHuntState();
    expect(chooseScoringStep(state, "south")).toEqual({
      pieceId: "south-cat",
      to: { x: 5, y: 0 },
    });
    expect(chooseHardAction(state, "south")).toEqual({
      kind: "step",
      pieceId: "south-cat",
      to: { x: 5, y: 0 },
    });
  });

  it("races instead of hunting a distant runner under lookahead", () => {
    // 1-ply lookahead cannot price hunt's payoff (the nerf lands next
    // turn, beyond the horizon): hunting moves the dog away from its
    // goal this turn, so racing wins the evaluation. The tournament
    // judges whether that trade is good.
    const state = pinTiles(
      columnState(
        [
          piece("south-dog", "dog", "south", 10, 8),
          piece("north-cat", "cat", "north", 10, 10),
        ],
        { nerfTokens: { north: 0, south: 1 } },
      ),
      [
        [9, 8, "water"],
        [11, 8, "water"],
      ],
    );
    expect(chooseHardAction(state, "south", () => 0.5)).toEqual({
      kind: "step",
      pieceId: "south-dog",
      to: { x: 10, y: 7 },
    });
  });

  it("does not count a goal tile under a known live trap as scoring", () => {
    const base = pinTiles(
      stateWith([piece("south-cat", "cat", "south", 5, 1)]),
      [[5, 0, "plains"]],
    );
    expect(chooseScoringStep(base, "south")).toEqual({
      pieceId: "south-cat",
      to: { x: 5, y: 0 },
    });
    const trapped = {
      ...base,
      traps: [{ owner: "north" as const, position: { x: 5, y: 0 }, triggered: false }],
    };
    expect(chooseScoringStep(trapped, "south")).toBeNull();
    // And the action falls through to racing, which routes around the
    // revealed trap rather than onto it.
    const action = chooseHardAction(trapped, "south");
    expect(action?.kind).toBe("step");
    if (action?.kind === "step") {
      expect(action.to).not.toEqual({ x: 5, y: 0 });
    }
  });
});

describe("shouldInterceptHard and interception", () => {
  it("trigger still fires, but lookahead races instead of trekking", () => {
    // The trigger predicate is unchanged, but the intercept step heads
    // DOWN the column (away from Hard's goal) toward a path 18 steps
    // away — a multi-turn plan with no 1-ply payoff — so racing wins
    // the evaluation. Side tiles pinned to water force the unique
    // race step.
    const state = pinTiles(
      columnState([
        piece("south-dog", "dog", "south", 10, 8),
        piece("north-cat", "cat", "north", 10, 25),
      ]),
      [
        [9, 8, "water"],
        [11, 8, "water"],
      ],
    );
    expect(shouldInterceptHard(state, "south")).toBe(true);
    expect(chooseHardAction(state, "south", () => 0.5)).toEqual({
      kind: "step",
      pieceId: "south-dog",
      to: { x: 10, y: 7 },
    });
  });

  it("old spoiler window: trigger true, lookahead still races", () => {
    const state = pinTiles(
      columnState(
        [
          piece("south-dog", "dog", "south", 10, 8),
          piece("north-cat", "cat", "north", 10, 15),
        ],
        { scores: { north: 4, south: 0 } },
      ),
      [
        [9, 8, "water"],
        [11, 8, "water"],
      ],
    );
    // 15 steps out, the generalized trigger says no — but the old
    // window (foe needs 1, hard needs 5) still fires as a predicate.
    expect(shouldInterceptHard(state, "south")).toBe(true);
    expect(chooseHardAction(state, "south", () => 0.5)).toEqual({
      kind: "step",
      pieceId: "south-dog",
      to: { x: 10, y: 7 },
    });
  });

  it("does not fire when hard is not far enough behind", () => {
    // Side tiles pinned to water so the straight column is the unique
    // cheapest race route (Dijkstra ties could otherwise pick a side
    // column first step with the same cost).
    const state = pinTiles(
      columnState([
        piece("south-dog", "dog", "south", 10, 6),
        piece("north-cat", "cat", "north", 10, 25),
      ]),
      [
        [9, 6, "water"],
        [11, 6, "water"],
      ],
    );
    // Foe 5 steps out, hard 6 — only 1 behind, so it races.
    expect(shouldInterceptHard(state, "south")).toBe(false);
    expect(chooseHardAction(state, "south")).toEqual({
      kind: "step",
      pieceId: "south-dog",
      to: { x: 10, y: 5 },
    });
  });
});

describe("evaluatePosition", () => {
  it("ranks a point above any positional term, and a win above all", () => {
    const base = stateWith([
      piece("south-cat", "cat", "south", 5, 5),
      piece("north-cat", "cat", "north", 5, 25),
    ]);
    const upOne = { ...base, scores: { north: 2, south: 3 } };
    const even = { ...base, scores: { north: 2, south: 2 } };
    // Everything else equal, so the difference is exactly one point.
    expect(evaluatePosition(upOne, "south") - evaluatePosition(even, "south")).toBe(1000);
    const won = { ...base, phase: "finished" as const, winner: "south" as const };
    const lost = { ...base, phase: "finished" as const, winner: "north" as const };
    expect(evaluatePosition(won, "south")).toBe(100000);
    expect(evaluatePosition(lost, "south")).toBe(-100000);
  });

  it("prefers the closer best runner, all else equal", () => {
    const close = stateWith([
      piece("south-cat", "cat", "south", 10, 5),
      piece("north-cat", "cat", "north", 10, 20),
    ]);
    const far = stateWith([
      piece("south-cat", "cat", "south", 10, 10),
      piece("north-cat", "cat", "north", 10, 20),
    ]);
    // South best 5 vs 10 rows out; foe best 10 both → 5 rows × 10.
    expect(evaluatePosition(close, "south") - evaluatePosition(far, "south")).toBe(50);
  });
});

describe("chooseHardAction lookahead", () => {
  it("picks the scoring step over hunting and racing", () => {
    const state = pinTiles(
      stateWith(
        [
          piece("south-cat", "cat", "south", 5, 1),
          piece("south-dog", "dog", "south", 11, 11),
          piece("north-cat", "cat", "north", 12, 12),
        ],
        { nerfTokens: { north: 0, south: 1 } },
      ),
      [
        [5, 0, "plains"],
        [11, 12, "plains"],
        [12, 11, "water"],
      ],
    );
    expect(chooseHardAction(state, "south", () => 0.5)).toEqual({
      kind: "step",
      pieceId: "south-cat",
      to: { x: 5, y: 0 },
    });
  });

  it("is deterministic for a fixed rng", () => {
    const state = dangerState(1);
    const rng = () => 0.5;
    expect(chooseHardAction(state, "south", rng)).toEqual(
      chooseHardAction(state, "south", rng),
    );
  });

  it("returns null when it is not that player's turn", () => {
    const state = dangerState(1);
    expect(chooseHardAction({ ...state, currentPlayer: "north" }, "south")).toBeNull();
  });
});
