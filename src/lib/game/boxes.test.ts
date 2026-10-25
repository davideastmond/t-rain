import { describe, expect, it } from "vitest";

import { mirrorPosition } from "./board";
import {
  boxCollector,
  generateMysteryBoxes,
  mysteryBoxAt,
  rollMysteryBox,
  senseAdjacentTraps,
} from "./boxes";
import { generateBoard } from "./board";
import { movePieceStep } from "./movement";
import {
  addTrap,
  movePieceTo,
  scenarioGame,
  setTerrain,
} from "./test-helpers";
import type { GameState } from "./types";

// Phase 1a (TEST_PLAN.md): mystery boxes — generation, the collection
// roll, trap sense, and collection through movePieceStep. The roll
// thresholds are tested with hardcoded (seed, boxRolls) pairs whose
// stream values were computed from the mulberry32 stream, not sampled:
// extra-steps < 0.40, bridge < 0.65, trap-sense < 0.90, else booby-trap.

const CAT = "north-cat";

describe("generateMysteryBoxes", () => {
  it("produces exactly one mirrored pair, one box per zone", () => {
    const { tiles } = generateBoard(42);
    const boxes = generateMysteryBoxes(42, tiles);
    expect(boxes).toHaveLength(2);
    expect(boxes[1].position).toEqual(mirrorPosition(boxes[0].position));
    const zones = boxes.map((b) => (b.position.y > 15 ? "south" : "north"));
    expect(zones.sort()).toEqual(["north", "south"]);
    expect(boxes.every((b) => !b.collected)).toBe(true);
  });

  it("places boxes only on passable tiles, never on goal or neutral rows", () => {
    for (const seed of [1, 7, 42, 123, 999]) {
      const { tiles } = generateBoard(seed);
      for (const box of generateMysteryBoxes(seed, tiles)) {
        const tile = tiles.find(
          (t) =>
            t.position.x === box.position.x &&
            t.position.y === box.position.y,
        );
        expect(tile?.terrain).not.toBe("water");
        expect(box.position.y).not.toBe(0);
        expect(box.position.y).not.toBe(30);
        expect(box.position.y).not.toBe(15);
      }
    }
  });

  it("is deterministic for a seed", () => {
    const { tiles } = generateBoard(42);
    expect(generateMysteryBoxes(42, tiles)).toEqual(
      generateMysteryBoxes(42, tiles),
    );
  });
});

describe("boxCollector", () => {
  it("gives the south-zone box to north and the north-zone box to south", () => {
    expect(boxCollector({ x: 10, y: 20 })).toBe("north");
    expect(boxCollector({ x: 10, y: 10 })).toBe("south");
  });
});

describe("rollMysteryBox", () => {
  it.each([
    // [seed, boxRolls, expected outcome] — stream values: 0.353, 0.536,
    // 0.780, 0.906, each landing in its threshold band.
    [0, 0, "extra-steps"],
    [2, 2, "bridge"],
    [4, 2, "trap-sense"],
    [0, 1, "booby-trap"],
  ] as const)(
    "seed %i, roll #%i → %s",
    (seed, boxRolls, expected) => {
      const state = { ...scenarioGame(seed), boxRolls };
      expect(rollMysteryBox(state)).toBe(expected);
    },
  );

  it("is deterministic for a seed and roll count", () => {
    const state = { ...scenarioGame(9), boxRolls: 3 };
    expect(rollMysteryBox(state)).toBe(rollMysteryBox(state));
  });
});

describe("senseAdjacentTraps", () => {
  it("reveals adjacent untriggered opponent traps only", () => {
    let state = movePieceTo(scenarioGame(), CAT, { x: 5, y: 5 });
    state = addTrap(state, "south", { x: 5, y: 6 });
    state = addTrap(state, "south", { x: 6, y: 5 });
    // Own trap, spent trap, diagonal trap, distant trap: none reveal.
    state = addTrap(state, "north", { x: 4, y: 5 });
    state = addTrap(state, "south", { x: 5, y: 4 }, true);
    state = addTrap(state, "south", { x: 6, y: 6 });
    state = addTrap(state, "south", { x: 5, y: 8 });
    const piece = state.pieces.find((p) => p.id === CAT)!;
    expect(senseAdjacentTraps(state, piece)).toEqual([
      { x: 5, y: 6 },
      { x: 6, y: 5 },
    ]);
  });

  it("does not repeat traps the owner already revealed", () => {
    let state = movePieceTo(scenarioGame(), CAT, { x: 5, y: 5 });
    state = addTrap(state, "south", { x: 5, y: 6 });
    state = {
      ...state,
      revealedTraps: { north: [{ x: 5, y: 6 }], south: [] },
    };
    const piece = state.pieces.find((p) => p.id === CAT)!;
    expect(senseAdjacentTraps(state, piece)).toEqual([]);
  });
});

describe("collection through movePieceStep", () => {
  // A known box pair, pinned so the tests don't depend on generated
  // placement: the south-zone box at (15, 20) collects for north.
  function boxGame(seed: number, boxRolls: number): GameState {
    let state = setTerrain(
      movePieceTo(scenarioGame(seed), CAT, { x: 15, y: 19 }),
      15,
      20,
      "plains",
    );
    state = {
      ...state,
      boxRolls,
      mysteryBoxes: [
        { position: { x: 15, y: 20 }, collected: false },
        { position: { x: 14, y: 10 }, collected: false },
      ],
    };
    return state;
  }

  function collect(state: GameState) {
    return movePieceStep(state, CAT, { x: 15, y: 20 });
  }

  it("is invader-only: the box owner's own piece does not collect", () => {
    // South steps onto its own zone's box.
    const state = setTerrain(
      movePieceTo(scenarioGame(0, "south"), "south-cat", { x: 15, y: 19 }),
      15,
      20,
      "plains",
    );
    const boxed: GameState = {
      ...state,
      mysteryBoxes: [
        { position: { x: 15, y: 20 }, collected: false },
        { position: { x: 14, y: 10 }, collected: false },
      ],
    };
    const result = movePieceStep(boxed, "south-cat", { x: 15, y: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.box).toBeNull();
    expect(result.state.mysteryBoxes[0].collected).toBe(false);
    expect(result.state.boxRolls).toBe(0);
  });

  it("extra-steps grants 2 bonus points to the collecting piece", () => {
    const result = collect(boxGame(0, 0));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.box).toBe("extra-steps");
    expect(result.state.bonusPoints[CAT]).toBe(2);
    expect(result.state.mysteryBoxes[0].collected).toBe(true);
    expect(result.state.boxRolls).toBe(1);
  });

  it("bridge grants the collecting piece a bridge", () => {
    const result = collect(boxGame(2, 2));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.box).toBe("bridge");
    expect(
      result.state.pieces.find((p) => p.id === CAT)?.hasBridge,
    ).toBe(true);
  });

  it("booby-trap eliminates the collector", () => {
    const result = collect(boxGame(0, 1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.box).toBe("booby-trap");
    expect(result.outcome.eliminated).toBe(true);
    expect(
      result.state.pieces.find((p) => p.id === CAT)?.status,
    ).toBe("eliminated");
    expect(result.state.mysteryBoxes[0].collected).toBe(true);
  });

  it("trap-sense reveals adjacent opponent traps, and revealed is not disarmed", () => {
    const boxed = setTerrain(
      addTrap(boxGame(4, 2), "south", { x: 16, y: 20 }),
      16,
      20,
      "plains",
    );
    const result = collect(boxed);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.box).toBe("trap-sense");
    expect(result.outcome.revealed).toEqual([{ x: 16, y: 20 }]);
    expect(result.state.revealedTraps.north).toEqual([{ x: 16, y: 20 }]);
    expect(
      result.state.pieces.find((p) => p.id === CAT)?.hasTrapSense,
    ).toBe(true);
    // The revealed trap still fires when stepped on.
    const stepped = movePieceStep(result.state, CAT, { x: 16, y: 20 });
    expect(stepped.ok).toBe(true);
    if (!stepped.ok) return;
    expect(stepped.outcome.eliminated).toBe(true);
  });

  it("mysteryBoxAt finds a box by tile", () => {
    const state = boxGame(0, 0);
    expect(mysteryBoxAt(state, { x: 15, y: 20 })?.collected).toBe(false);
    expect(mysteryBoxAt(state, { x: 0, y: 0 })).toBeUndefined();
  });
});
