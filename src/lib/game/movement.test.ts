import { describe, expect, it } from "vitest";

import {
  canStep,
  endTurn,
  findDrownedPiece,
  legalStepTargets,
  movePieceStep,
} from "./movement";
import { addTrap, movePieceTo, scenarioGame, setTerrain } from "./test-helpers";
import type { GameState } from "./types";

// Phase 1a (TEST_PLAN.md): movement rules — pool and caps, trap timing,
// scoring, drowning, attrition, and end-of-turn resets. Fixture states
// come from scenarioGame: full rosters parked out of the way, so
// win/attrition math behaves exactly as in a real game.

const CAT = "north-cat";
const DOG = "north-dog";

describe("canStep", () => {
  it("rejects steps when the game is not playing", () => {
    const state = { ...scenarioGame(), phase: "setup" as const };
    expect(canStep(state, CAT, { x: 0, y: 3 })).toEqual({
      ok: false,
      error: "wrong-phase",
    });
  });

  it("rejects unknown pieces", () => {
    expect(canStep(scenarioGame(), "north-nope", { x: 0, y: 3 })).toEqual({
      ok: false,
      error: "piece-not-found",
    });
  });

  it("rejects pieces that are not active", () => {
    const state = movePieceTo(scenarioGame(), CAT, { x: 5, y: 2 }, {
      status: "eliminated",
    });
    expect(canStep(state, CAT, { x: 5, y: 3 })).toEqual({
      ok: false,
      error: "piece-not-active",
    });
  });

  it("rejects the opponent's pieces", () => {
    const state = scenarioGame();
    expect(canStep(state, "south-cat", { x: 0, y: 26 })).toEqual({
      ok: false,
      error: "not-your-turn",
    });
  });

  it("rejects non-adjacent steps: two away, diagonal, and off-board", () => {
    const state = movePieceTo(scenarioGame(), CAT, { x: 5, y: 5 });
    expect(canStep(state, CAT, { x: 5, y: 7 })).toEqual({
      ok: false,
      error: "not-adjacent",
    });
    expect(canStep(state, CAT, { x: 6, y: 6 })).toEqual({
      ok: false,
      error: "not-adjacent",
    });
    const edge = movePieceTo(scenarioGame(), CAT, { x: 0, y: 5 });
    expect(canStep(edge, CAT, { x: -1, y: 5 })).toEqual({
      ok: false,
      error: "not-adjacent",
    });
  });

  it("rejects water without a bridge, and allows it with one", () => {
    const state = setTerrain(
      movePieceTo(scenarioGame(), CAT, { x: 5, y: 5 }),
      5,
      6,
      "water",
    );
    expect(canStep(state, CAT, { x: 5, y: 6 })).toEqual({
      ok: false,
      error: "on-water",
    });
    const bridged = movePieceTo(state, CAT, { x: 5, y: 5 }, {
      hasBridge: true,
    });
    expect(canStep(bridged, CAT, { x: 5, y: 6 })).toEqual({ ok: true });
  });

  it("rejects occupied tiles", () => {
    const state = setTerrain(
      movePieceTo(
        movePieceTo(scenarioGame(), CAT, { x: 5, y: 5 }),
        DOG,
        { x: 5, y: 6 },
      ),
      5,
      6,
      "plains",
    );
    expect(canStep(state, CAT, { x: 5, y: 6 })).toEqual({
      ok: false,
      error: "occupied",
    });
  });

  it("rejects steps that would exceed the per-piece cap", () => {
    const state = setTerrain(
      {
        ...movePieceTo(scenarioGame(), CAT, { x: 5, y: 5 }),
        spentThisTurn: { [CAT]: 3 },
      },
      5,
      6,
      "plains",
    );
    expect(canStep(state, CAT, { x: 5, y: 6 })).toEqual({
      ok: false,
      error: "exceeds-piece-cap",
    });
    // Spent 2 + a forest step (cost 2) is also over the cap of 3.
    const forest = setTerrain(
      { ...movePieceTo(scenarioGame(), CAT, { x: 5, y: 5 }),
        spentThisTurn: { [CAT]: 2 } },
      5,
      6,
      "forest",
    );
    expect(canStep(forest, CAT, { x: 5, y: 6 })).toEqual({
      ok: false,
      error: "exceeds-piece-cap",
    });
  });

  it("rejects steps the pool cannot pay", () => {
    const state = setTerrain(
      { ...movePieceTo(scenarioGame(), CAT, { x: 5, y: 5 }),
        movementPointsLeft: 1 },
      5,
      6,
      "forest",
    );
    expect(canStep(state, CAT, { x: 5, y: 6 })).toEqual({
      ok: false,
      error: "insufficient-points",
    });
  });

  it("allows plains and forest steps the pool and cap can pay", () => {
    const state = setTerrain(
      movePieceTo(scenarioGame(), CAT, { x: 5, y: 5 }),
      5,
      6,
      "plains",
    );
    expect(canStep(state, CAT, { x: 5, y: 6 })).toEqual({ ok: true });
    const forest = setTerrain(state, 5, 6, "forest");
    expect(canStep(forest, CAT, { x: 5, y: 6 })).toEqual({ ok: true });
  });
});

describe("legalStepTargets", () => {
  it("agrees with canStep on every neighbouring tile", () => {
    const state = setTerrain(
      movePieceTo(scenarioGame(), CAT, { x: 5, y: 5 }),
      5,
      6,
      "water",
    );
    const neighbours = [
      { x: 5, y: 4 },
      { x: 5, y: 6 },
      { x: 4, y: 5 },
      { x: 6, y: 5 },
    ];
    const expected = neighbours.filter(
      (to) => canStep(state, CAT, to).ok,
    );
    expect(legalStepTargets(state, CAT)).toEqual(expected);
    // The water neighbour is the one excluded here.
    expect(legalStepTargets(state, CAT)).not.toContainEqual({ x: 5, y: 6 });
  });

  it("is empty for a piece that cannot move", () => {
    const state = movePieceTo(scenarioGame(), CAT, { x: 5, y: 5 }, {
      status: "eliminated",
    });
    expect(legalStepTargets(state, CAT)).toEqual([]);
  });
});

describe("movePieceStep", () => {
  it("pays the terrain cost from the pool and tallies the piece", () => {
    const state = setTerrain(
      movePieceTo(scenarioGame(), CAT, { x: 5, y: 5 }),
      5,
      6,
      "plains",
    );
    const result = movePieceStep(state, CAT, { x: 5, y: 6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toEqual({
      cost: 1,
      eliminated: false,
      scored: false,
      box: null,
      revealed: [],
      pickup: null,
    });
    expect(result.state.movementPointsLeft).toBe(9);
    expect(result.state.spentThisTurn[CAT]).toBe(1);
    expect(
      result.state.pieces.find((p) => p.id === CAT)?.position,
    ).toEqual({ x: 5, y: 6 });
    // Pure: the input state is untouched.
    expect(state.movementPointsLeft).toBe(10);
    expect(state.pieces.find((p) => p.id === CAT)?.position).toEqual({
      x: 5,
      y: 5,
    });
  });

  it("charges forest at 2 points", () => {
    const state = setTerrain(
      movePieceTo(scenarioGame(), CAT, { x: 5, y: 5 }),
      5,
      6,
      "forest",
    );
    const result = movePieceStep(state, CAT, { x: 5, y: 6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.cost).toBe(2);
    expect(result.state.movementPointsLeft).toBe(8);
    expect(result.state.spentThisTurn[CAT]).toBe(2);
  });

  it("spends bonus points first, and they do not count toward the cap", () => {
    let state: GameState = {
      ...movePieceTo(scenarioGame(), CAT, { x: 5, y: 5 }),
      bonusPoints: { [CAT]: 2 },
    };
    // The whole chain runs down one column: pin it to plains so the
    // test measures points, not generated terrain.
    for (let y = 6; y <= 10; y++) state = setTerrain(state, 5, y, "plains");
    // Two free steps: pool and tally untouched, bonus spent.
    for (const to of [
      { x: 5, y: 6 },
      { x: 5, y: 7 },
    ]) {
      const result = movePieceStep(state, CAT, to);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      state = result.state;
    }
    expect(state.movementPointsLeft).toBe(10);
    expect(state.spentThisTurn[CAT] ?? 0).toBe(0);
    expect(state.bonusPoints[CAT]).toBe(0);
    // Now the piece still has its full 3-point cap from the pool.
    for (const to of [
      { x: 5, y: 8 },
      { x: 5, y: 9 },
      { x: 5, y: 10 },
    ]) {
      const result = movePieceStep(state, CAT, to);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      state = result.state;
    }
    expect(state.spentThisTurn[CAT]).toBe(3);
    expect(movePieceStep(state, CAT, { x: 5, y: 11 })).toEqual({
      ok: false,
      error: "exceeds-piece-cap",
    });
  });

  it("fires a trap on entry: the piece is eliminated, the trap is spent", () => {
    const state = setTerrain(
      addTrap(
        movePieceTo(scenarioGame(), CAT, { x: 5, y: 5 }),
        "south",
        { x: 5, y: 6 },
      ),
      5,
      6,
      "plains",
    );
    const result = movePieceStep(state, CAT, { x: 5, y: 6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.eliminated).toBe(true);
    expect(result.outcome.scored).toBe(false);
    expect(
      result.state.pieces.find((p) => p.id === CAT)?.status,
    ).toBe("eliminated");
    expect(result.state.traps[0].triggered).toBe(true);
    // One elimination with 14 active left does not end the game.
    expect(result.state.phase).toBe("playing");
  });

  it("a trap on the goal row fires before scoring", () => {
    const state = setTerrain(
      addTrap(
        movePieceTo(scenarioGame(), CAT, { x: 15, y: 29 }),
        "south",
        { x: 15, y: 30 },
      ),
      15,
      30,
      "plains",
    );
    const result = movePieceStep(state, CAT, { x: 15, y: 30 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.eliminated).toBe(true);
    expect(result.outcome.scored).toBe(false);
    expect(result.state.scores.north).toBe(0);
  });

  it("does not fire the mover's own traps or spent traps", () => {
    const own = setTerrain(
      addTrap(
        movePieceTo(scenarioGame(), CAT, { x: 5, y: 5 }),
        "north",
        { x: 5, y: 6 },
      ),
      5,
      6,
      "plains",
    );
    const ownResult = movePieceStep(own, CAT, { x: 5, y: 6 });
    expect(ownResult.ok).toBe(true);
    if (ownResult.ok) expect(ownResult.outcome.eliminated).toBe(false);

    const spent = setTerrain(
      addTrap(
        movePieceTo(scenarioGame(), CAT, { x: 5, y: 5 }),
        "south",
        { x: 5, y: 6 },
        true,
      ),
      5,
      6,
      "plains",
    );
    const spentResult = movePieceStep(spent, CAT, { x: 5, y: 6 });
    expect(spentResult.ok).toBe(true);
    if (spentResult.ok) expect(spentResult.outcome.eliminated).toBe(false);
  });

  it("scores on the goal row and earns a pending nerf token", () => {
    const state = setTerrain(
      movePieceTo(scenarioGame(), CAT, { x: 15, y: 29 }),
      15,
      30,
      "plains",
    );
    const result = movePieceStep(state, CAT, { x: 15, y: 30 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.scored).toBe(true);
    expect(result.state.scores.north).toBe(1);
    expect(result.state.nerfTokensPending.north).toBe(1);
    expect(result.state.nerfTokens.north).toBe(0);
    expect(
      result.state.pieces.find((p) => p.id === CAT)?.status,
    ).toBe("scored");
  });

  it("never scores on a water tile, even on the goal row", () => {
    const state = setTerrain(
      movePieceTo(scenarioGame(), CAT, { x: 15, y: 29 }, { hasBridge: true }),
      15,
      30,
      "water",
    );
    const result = movePieceStep(state, CAT, { x: 15, y: 30 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.scored).toBe(false);
    expect(result.outcome.cost).toBe(1);
    expect(result.state.scores.north).toBe(0);
    // The crossing spends the bridge.
    expect(
      result.state.pieces.find((p) => p.id === CAT)?.hasBridge,
    ).toBe(false);
  });

  it("wins immediately on the fifth score", () => {
    const state = setTerrain(
      { ...movePieceTo(scenarioGame(), CAT, { x: 15, y: 29 }),
        scores: { north: 4, south: 0 } },
      15,
      30,
      "plains",
    );
    const result = movePieceStep(state, CAT, { x: 15, y: 30 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.phase).toBe("finished");
    expect(result.state.winner).toBe("north");
  });

  it("loses immediately by attrition when too few pieces can still score", () => {
    let state = scenarioGame();
    // Every north piece except the cat is already gone; no scores yet.
    state = {
      ...state,
      pieces: state.pieces.map((p) =>
        p.owner === "north" && p.id !== CAT
          ? { ...p, status: "eliminated" as const }
          : p,
      ),
    };
    state = setTerrain(
      addTrap(
        movePieceTo(state, CAT, { x: 5, y: 5 }),
        "south",
        { x: 5, y: 6 },
      ),
      5,
      6,
      "plains",
    );
    const result = movePieceStep(state, CAT, { x: 5, y: 6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.phase).toBe("finished");
    expect(result.state.winner).toBe("south");
  });

  it("caps pending nerf tokens at 2 across usable + pending", () => {
    const capped = setTerrain(
      { ...movePieceTo(scenarioGame(), CAT, { x: 15, y: 29 }),
        nerfTokens: { north: 1, south: 0 },
        nerfTokensPending: { north: 1, south: 0 } },
      15,
      30,
      "plains",
    );
    const cappedResult = movePieceStep(capped, CAT, { x: 15, y: 30 });
    expect(cappedResult.ok).toBe(true);
    if (cappedResult.ok) {
      expect(cappedResult.state.nerfTokensPending.north).toBe(1);
    }
  });
});

describe("endTurn", () => {
  it("flips the player, refills the pool, and clears tallies and bonus", () => {
    const state = {
      ...movePieceTo(scenarioGame(), CAT, { x: 5, y: 5 }),
      movementPointsLeft: 4,
      spentThisTurn: { [CAT]: 2 },
      bonusPoints: { [CAT]: 1 },
    };
    const result = endTurn(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.currentPlayer).toBe("south");
    expect(result.state.movementPointsLeft).toBe(10);
    expect(result.state.spentThisTurn).toEqual({});
    expect(result.state.bonusPoints).toEqual({});
  });

  it("flips pending nerf tokens to usable, capped at 2", () => {
    const state = {
      ...scenarioGame(),
      nerfTokens: { north: 1, south: 0 },
      nerfTokensPending: { north: 2, south: 0 },
    };
    const result = endTurn(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.nerfTokens.north).toBe(2);
    expect(result.state.nerfTokensPending.north).toBe(0);
  });

  it("clears trap sense but keeps the reveals", () => {
    const state = {
      ...movePieceTo(scenarioGame(), CAT, { x: 5, y: 5 }, {
        hasTrapSense: true,
      }),
      revealedTraps: { north: [{ x: 5, y: 6 }], south: [] },
    };
    const result = endTurn(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.state.pieces.find((p) => p.id === CAT)?.hasTrapSense,
    ).toBe(false);
    expect(result.state.revealedTraps.north).toEqual([{ x: 5, y: 6 }]);
  });

  it("drowns a piece left on water and reports it", () => {
    const before = setTerrain(
      movePieceTo(scenarioGame(), CAT, { x: 5, y: 5 }),
      5,
      5,
      "water",
    );
    const result = endTurn(before);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.state.pieces.find((p) => p.id === CAT)?.status,
    ).toBe("eliminated");
    expect(findDrownedPiece(before, result.state)?.id).toBe(CAT);
    // The game continues, so the turn passes.
    expect(result.state.currentPlayer).toBe("south");
  });

  it("drowning the last able piece loses immediately without passing the turn", () => {
    let before = scenarioGame();
    before = {
      ...before,
      pieces: before.pieces.map((p) =>
        p.owner === "north" && p.id !== CAT
          ? { ...p, status: "eliminated" as const }
          : p,
      ),
    };
    before = setTerrain(
      movePieceTo(before, CAT, { x: 5, y: 5 }),
      5,
      5,
      "water",
    );
    const result = endTurn(before);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.phase).toBe("finished");
    expect(result.state.winner).toBe("south");
    expect(result.state.currentPlayer).toBe("north");
  });

  it("findDrownedPiece returns undefined when nothing drowned", () => {
    const before = scenarioGame();
    const result = endTurn(before);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findDrownedPiece(before, result.state)).toBeUndefined();
  });

  it("rejects ending the turn when the game is not playing", () => {
    const state = { ...scenarioGame(), phase: "setup" as const };
    expect(endTurn(state)).toEqual({ ok: false, error: "wrong-phase" });
  });
});
