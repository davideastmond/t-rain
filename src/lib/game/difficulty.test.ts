// CPU difficulty tiers (HARD_CPU_PHASE2_SPEC.md step 5): Normal is
// full play + auto setup, Hard is hard@v5 play + choke setup. The
// play dispatch is proven on the state where the two tiers disagree:
// full hunts a distant runner, lookahead races instead.
import { describe, expect, it } from "vitest";

import {
  chooseDifficultyAction,
  chooseDifficultySetup,
  CPU_DIFFICULTIES,
} from "./difficulty";
import { createGame, isInTrapZone } from "./setup";
import { chokeScores } from "./setup-choke";
import { TERRAIN_INFO, type GameState, type Piece } from "./types";

function piece(
  id: string,
  owner: "north" | "south",
  x: number,
  y: number,
): Piece {
  return {
    id,
    character: "cat",
    owner,
    position: { x, y },
    status: "active",
    hasBridge: false,
    hasTrapSense: false,
  };
}

function huntVsRaceState(): GameState {
  const base = createGame(42);
  const tiles = base.tiles.map((tile) => {
    const { x, y } = tile.position;
    if (x === 10) return { ...tile, terrain: "plains" as const };
    if ((x === 9 || x === 11) && y === 8) {
      return { ...tile, terrain: "water" as const };
    }
    return tile;
  });
  return {
    ...base,
    tiles,
    pieces: [
      piece("south-dog", "south", 10, 8),
      piece("north-cat", "north", 10, 10),
    ],
    traps: [],
    mysteryBoxes: [],
    phase: "playing",
    currentPlayer: "south",
    movementPointsLeft: 10,
    spentThisTurn: {},
    scores: { north: 0, south: 0 },
    nerfTokens: { north: 0, south: 1 },
  };
}

describe("CPU_DIFFICULTIES", () => {
  it("maps Normal to full/auto and Hard to hard/choke", () => {
    expect(CPU_DIFFICULTIES.normal.play).toBe("full");
    expect(CPU_DIFFICULTIES.normal.setup).toBe("auto");
    expect(CPU_DIFFICULTIES.hard.play).toBe("hard");
    expect(CPU_DIFFICULTIES.hard.setup).toBe("choke");
  });
});

describe("chooseDifficultyAction", () => {
  it("hunts under Normal and races under Hard on the same state", () => {
    const state = huntVsRaceState();
    expect(chooseDifficultyAction("normal", state, "south")).toEqual({
      kind: "step",
      pieceId: "south-dog",
      to: { x: 10, y: 9 },
    });
    expect(chooseDifficultyAction("hard", state, "south")).toEqual({
      kind: "step",
      pieceId: "south-dog",
      to: { x: 10, y: 7 },
    });
  });
});

describe("chooseDifficultySetup", () => {
  it("places 10 traps under both tiers, and Hard includes the top choke tile", () => {
    const base = createGame(42);
    const normal = chooseDifficultySetup("normal", base, "north");
    expect(normal.ok).toBe(true);
    if (normal.ok) expect(normal.state.traps).toHaveLength(10);

    const hard = chooseDifficultySetup("hard", base, "north");
    expect(hard.ok).toBe(true);
    if (!hard.ok) return;
    expect(hard.state.traps).toHaveLength(10);
    const pieceKeys = new Set(
      hard.state.pieces
        .filter((p) => p.owner === "north")
        .map((p) => `${p.position.x},${p.position.y}`),
    );
    const scores = chokeScores(base, "north");
    let topTile = "";
    let topScore = -1;
    for (const tile of base.tiles) {
      const key = `${tile.position.x},${tile.position.y}`;
      if (!isInTrapZone("north", tile.position)) continue;
      if (!TERRAIN_INFO[tile.terrain].passable) continue;
      if (pieceKeys.has(key)) continue;
      const score = scores.get(key) ?? 0;
      if (score > topScore) {
        topScore = score;
        topTile = key;
      }
    }
    expect(
      hard.state.traps.map((t) => `${t.position.x},${t.position.y}`),
    ).toContain(topTile);
  });
});
