import { describe, expect, it } from "vitest";

import {
  ALL_CHARACTERS,
  applySetup,
  autoPlaceSetup,
  canPlacePieceAt,
  canPlaceTrapAt,
  createGame,
  isInPieceZone,
  isInTrapZone,
} from "./setup";
import { MAX_NEUTRAL_TRAPS, NEUTRAL_ROW, TRAPS_PER_PLAYER } from "./constants";
import { mysteryBoxAt } from "./boxes";
import type { GameState, Position } from "./types";

// Phase 1b (TEST_PLAN.md): setup — zones, single-tile checks, complete
// setup validation, and auto-placement.

// A valid north setup built from the game's own tiles: the first
// passable piece-zone tiles for pieces, the first passable trap-zone
// tiles for traps (never on a box, at most 3 on the neutral row).
function validSetup(state: GameState, player: "north" | "south") {
  const passable = (position: Position) =>
    state.tiles.find(
      (t) =>
        t.position.x === position.x && t.position.y === position.y,
    )?.terrain !== "water";
  const piecePositions = state.tiles
    .filter(
      (t) => isInPieceZone(player, t.position) && passable(t.position),
    )
    .slice(0, 15)
    .map((t) => t.position);
  const boxPositions = new Set(
    state.mysteryBoxes.map((b) => `${b.position.x},${b.position.y}`),
  );
  const pieceKeys = new Set(piecePositions.map((p) => `${p.x},${p.y}`));
  const trapPositions: Position[] = [];
  let neutral = 0;
  for (const tile of state.tiles) {
    if (trapPositions.length >= TRAPS_PER_PLAYER) break;
    const { position } = tile;
    if (!isInTrapZone(player, position)) continue;
    if (!passable(position)) continue;
    if (boxPositions.has(`${position.x},${position.y}`)) continue;
    if (pieceKeys.has(`${position.x},${position.y}`)) continue;
    if (position.y === NEUTRAL_ROW) {
      if (neutral >= MAX_NEUTRAL_TRAPS) continue;
      neutral++;
    }
    trapPositions.push(position);
  }
  return {
    piecePlacements: ALL_CHARACTERS.map((character, i) => ({
      character,
      position: piecePositions[i],
    })),
    trapPositions,
  };
}

describe("zones", () => {
  it("piece zones are the back 3 rows", () => {
    expect(isInPieceZone("north", { x: 0, y: 2 })).toBe(true);
    expect(isInPieceZone("north", { x: 0, y: 3 })).toBe(false);
    expect(isInPieceZone("south", { x: 0, y: 28 })).toBe(true);
    expect(isInPieceZone("south", { x: 0, y: 27 })).toBe(false);
  });

  it("trap zones are the whole zone plus the neutral row", () => {
    expect(isInTrapZone("north", { x: 0, y: 15 })).toBe(true);
    expect(isInTrapZone("north", { x: 0, y: 16 })).toBe(false);
    expect(isInTrapZone("south", { x: 0, y: 15 })).toBe(true);
    expect(isInTrapZone("south", { x: 0, y: 14 })).toBe(false);
  });
});

describe("canPlacePieceAt", () => {
  it("rejects out-of-zone and off-board tiles", () => {
    const state = createGame(42);
    expect(canPlacePieceAt(state, "north", { x: 0, y: 3 }, [])).toEqual({
      ok: false,
      error: "piece-outside-zone",
    });
    expect(canPlacePieceAt(state, "north", { x: -1, y: 0 }, [])).toEqual({
      ok: false,
      error: "piece-outside-zone",
    });
  });

  it("rejects water, duplicates, and occupied tiles", () => {
    const state = createGame(42);
    // Pin one piece-zone tile to water so the case cannot depend on
    // generated terrain.
    const waterState = {
      ...state,
      tiles: state.tiles.map((t) =>
        t.position.x === 0 && t.position.y === 0
          ? { ...t, terrain: "water" as const }
          : t,
      ),
    };
    expect(canPlacePieceAt(waterState, "north", { x: 0, y: 0 }, [])).toEqual({
      ok: false,
      error: "on-water",
    });
    const tile = state.tiles.find(
      (t) => isInPieceZone("north", t.position) && t.terrain !== "water",
    )!;
    expect(canPlacePieceAt(state, "north", tile.position, [])).toEqual({
      ok: true,
    });
    expect(
      canPlacePieceAt(state, "north", tile.position, [tile.position]),
    ).toEqual({ ok: false, error: "duplicate-position" });
  });
});

describe("canPlaceTrapAt", () => {
  it("rejects out-of-zone and off-board tiles", () => {
    const state = createGame(42);
    expect(canPlaceTrapAt(state, "north", { x: 0, y: 16 }, [])).toEqual({
      ok: false,
      error: "trap-outside-zone",
    });
  });

  it("rejects water, mystery-box tiles, and duplicates", () => {
    const state = createGame(42);
    const box = state.mysteryBoxes.find((b) => b.position.y <= NEUTRAL_ROW)!;
    expect(canPlaceTrapAt(state, "north", box.position, [])).toEqual({
      ok: false,
      error: "on-mystery-box",
    });
    expect(mysteryBoxAt(state, box.position)).toBeDefined();
    const tile = state.tiles.find(
      (t) => isInTrapZone("north", t.position) && t.terrain !== "water",
    )!;
    expect(canPlaceTrapAt(state, "north", tile.position, [])).toEqual({
      ok: true,
    });
    expect(
      canPlaceTrapAt(state, "north", tile.position, [tile.position]),
    ).toEqual({ ok: false, error: "duplicate-position" });
  });

  it("enforces the trap count and the neutral-row cap", () => {
    const state = createGame(42);
    const ten = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0 }));
    expect(canPlaceTrapAt(state, "north", { x: 10, y: 0 }, ten)).toEqual({
      ok: false,
      error: "wrong-trap-count",
    });
    // Real passable neutral tiles — generated terrain must not turn
    // this into an on-water case instead.
    const neutralTiles = state.tiles
      .filter((t) => t.position.y === NEUTRAL_ROW && t.terrain !== "water")
      .slice(0, 4)
      .map((t) => t.position);
    expect(neutralTiles).toHaveLength(4);
    expect(
      canPlaceTrapAt(state, "north", neutralTiles[3], neutralTiles.slice(0, 3)),
    ).toEqual({ ok: false, error: "too-many-neutral-traps" });
    expect(canPlaceTrapAt(state, "north", neutralTiles[3], [])).toEqual({
      ok: true,
    });
  });
});

describe("applySetup", () => {
  it("accepts a valid setup, stays in setup after the first player", () => {
    const state = createGame(42);
    const { piecePlacements, trapPositions } = validSetup(state, "north");
    expect(piecePlacements).toHaveLength(15);
    expect(trapPositions).toHaveLength(10);
    const result = applySetup(state, "north", piecePlacements, trapPositions);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.phase).toBe("setup");
    expect(result.state.pieces).toHaveLength(15);
    expect(result.state.traps).toHaveLength(10);
    expect(result.state.pieces.map((p) => p.id).sort()).toEqual(
      ALL_CHARACTERS.map((c) => `north-${c}`).sort(),
    );
    // Pure: the input state is untouched.
    expect(state.pieces).toEqual([]);
  });

  it("flips to playing when the second player applies", () => {
    let state = createGame(42);
    const north = validSetup(state, "north");
    const first = applySetup(state, "north", north.piecePlacements, north.trapPositions);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    state = first.state;
    const south = validSetup(state, "south");
    const second = applySetup(state, "south", south.piecePlacements, south.trapPositions);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.state.phase).toBe("playing");
    expect(second.state.pieces).toHaveLength(30);
    expect(second.state.traps).toHaveLength(20);
  });

  it("rejects a second setup from the same player", () => {
    const state = createGame(42);
    const { piecePlacements, trapPositions } = validSetup(state, "north");
    const first = applySetup(state, "north", piecePlacements, trapPositions);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(
      applySetup(first.state, "north", piecePlacements, trapPositions),
    ).toEqual({ ok: false, error: "already-setup" });
  });

  it("rejects setups when the game is not in setup phase", () => {
    const playing = { ...createGame(42), phase: "playing" as const };
    const { piecePlacements, trapPositions } = validSetup(playing, "north");
    expect(applySetup(playing, "north", piecePlacements, trapPositions)).toEqual({
      ok: false,
      error: "wrong-phase",
    });
  });

  it("rejects wrong piece counts and duplicate characters", () => {
    const state = createGame(42);
    const { piecePlacements, trapPositions } = validSetup(state, "north");
    expect(
      applySetup(state, "north", piecePlacements.slice(0, 14), trapPositions),
    ).toEqual({ ok: false, error: "wrong-piece-count" });
    const duplicated = piecePlacements.map((p, i) => ({
      ...p,
      character: i === 0 ? piecePlacements[1].character : p.character,
    }));
    expect(applySetup(state, "north", duplicated, trapPositions)).toEqual({
      ok: false,
      error: "duplicate-character",
    });
  });

  it("rejects a piece outside the zone", () => {
    const state = createGame(42);
    const { piecePlacements, trapPositions } = validSetup(state, "north");
    const moved = piecePlacements.map((p, i) =>
      i === 0 ? { ...p, position: { x: 0, y: 5 } } : p,
    );
    expect(applySetup(state, "north", moved, trapPositions)).toEqual({
      ok: false,
      error: "piece-outside-zone",
    });
  });

  it("rejects wrong trap counts and too many neutral traps", () => {
    const state = createGame(42);
    const { piecePlacements, trapPositions } = validSetup(state, "north");
    expect(
      applySetup(state, "north", piecePlacements, trapPositions.slice(0, 9)),
    ).toEqual({ ok: false, error: "wrong-trap-count" });
    const neutralTiles = state.tiles
      .filter((t) => t.position.y === NEUTRAL_ROW && t.terrain !== "water")
      .slice(0, 4)
      .map((t) => t.position);
    const nonNeutral = trapPositions
      .filter((p) => p.y !== NEUTRAL_ROW)
      .slice(0, 6);
    const neutralHeavy = [...neutralTiles, ...nonNeutral];
    expect(applySetup(state, "north", piecePlacements, neutralHeavy)).toEqual({
      ok: false,
      error: "too-many-neutral-traps",
    });
  });
});

describe("autoPlaceSetup", () => {
  it("places a valid setup through the same validation", () => {
    const state = createGame(42);
    const result = autoPlaceSetup(state, "north");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pieces).toHaveLength(15);
    expect(result.state.traps).toHaveLength(10);
    expect(
      result.state.traps.filter((t) => t.position.y === NEUTRAL_ROW).length,
    ).toBeLessThanOrEqual(MAX_NEUTRAL_TRAPS);
    expect(
      result.state.traps.every(
        (t) => !mysteryBoxAt(result.state, t.position),
      ),
    ).toBe(true);
    expect(
      new Set(result.state.pieces.map((p) => p.character)).size,
    ).toBe(15);
  });

  it("is deterministic for a seed and player", () => {
    const a = autoPlaceSetup(createGame(42), "north");
    const b = autoPlaceSetup(createGame(42), "north");
    expect(a).toEqual(b);
  });

  it("flips to playing after the second auto-placement", () => {
    const first = autoPlaceSetup(createGame(42), "north");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = autoPlaceSetup(first.state, "south");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.state.phase).toBe("playing");
  });
});

describe("createGame", () => {
  it("starts in setup with empty boards, full pool, and two boxes", () => {
    const state = createGame(42);
    expect(state.phase).toBe("setup");
    expect(state.pieces).toEqual([]);
    expect(state.traps).toEqual([]);
    expect(state.scores).toEqual({ north: 0, south: 0 });
    expect(state.movementPointsLeft).toBe(10);
    expect(state.mysteryBoxes).toHaveLength(2);
    expect(state.winner).toBeNull();
  });

  it("picks the first player deterministically from the seed", () => {
    expect(createGame(42).currentPlayer).toBe(
      createGame(42).currentPlayer,
    );
  });
});
