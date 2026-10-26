// Phase: Hard CPU v1 (HARD_CPU_SPEC.md rollout step 2) — danger-aware
// racing only. States are built minimally (a few pieces, pinned plains
// columns) so route costs are exact regardless of the generated board:
// a straight plains column is always the cheapest route for its piece.
import { describe, expect, it } from "vitest";

import { getStrategy } from "../battle/strategies";
import { chooseCpuStep } from "./cpu";
import {
  chooseHardAction,
  chooseHardRaceStep,
  HARD_DANGER_COST,
  isDangerTile,
} from "./cpu-hard";
import { createGame } from "./setup";
import type { CharacterId, GameState, Piece, PlayerId } from "./types";

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
  it("is registered as hard@v1", () => {
    expect(getStrategy("hard").version).toBe("hard@v1");
  });
});
