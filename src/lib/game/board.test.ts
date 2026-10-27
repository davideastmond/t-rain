import { describe, expect, it } from "vitest";

import {
  crossingEntryCount,
  generateBoard,
  mirrorPosition,
  tileIndex,
} from "./board";
import { MIN_CROSSING_ENTRIES } from "./constants";
import type { TerrainType, Tile } from "./types";

// Phase 1b (TEST_PLAN.md): board generation — layout, mirroring, and
// the crossing guarantee.

describe("tileIndex", () => {
  it("lays tiles out row-major, y * 30 + x", () => {
    expect(tileIndex(0, 0)).toBe(0);
    expect(tileIndex(29, 0)).toBe(29);
    expect(tileIndex(0, 1)).toBe(30);
    expect(tileIndex(29, 30)).toBe(929);
  });
});

describe("mirrorPosition", () => {
  it("is an involution across the 180° rotation", () => {
    expect(mirrorPosition({ x: 0, y: 0 })).toEqual({ x: 29, y: 30 });
    for (const p of [
      { x: 0, y: 0 },
      { x: 5, y: 7 },
      { x: 29, y: 30 },
      { x: 14, y: 15 },
    ]) {
      expect(mirrorPosition(mirrorPosition(p))).toEqual(p);
    }
  });
});

describe("generateBoard", () => {
  it("is deterministic for a seed", () => {
    expect(generateBoard(42)).toEqual(generateBoard(42));
  });

  it("produces 930 tiles whose positions match their indices", () => {
    const { tiles } = generateBoard(42);
    expect(tiles).toHaveLength(930);
    tiles.forEach((tile, i) => {
      expect(tile.position).toEqual({
        x: i % 30,
        y: Math.floor(i / 30),
      });
    });
  });

  it("mirrors terrain: every tile matches its 180° mirror", () => {
    for (const seed of [1, 42, 123]) {
      const { tiles } = generateBoard(seed);
      for (const tile of tiles) {
        const mirror = mirrorPosition(tile.position);
        expect(tiles[tileIndex(mirror.x, mirror.y)].terrain).toBe(
          tile.terrain,
        );
      }
    }
  });

  it("always meets the crossing guarantee", () => {
    for (let seed = 0; seed < 50; seed++) {
      const { tiles } = generateBoard(seed);
      expect(crossingEntryCount(tiles)).toBeGreaterThanOrEqual(
        MIN_CROSSING_ENTRIES,
      );
    }
  });

  it("picks a valid biome", () => {
    for (let seed = 0; seed < 20; seed++) {
      expect(["grass", "desert", "ice"]).toContain(generateBoard(seed).biome);
    }
  });

  it("rolls all three terrain types across seeds", () => {
    const seen = new Set<TerrainType>();
    for (let seed = 0; seed < 10; seed++) {
      for (const tile of generateBoard(seed).tiles) seen.add(tile.terrain);
    }
    expect(seen).toEqual(new Set(["plains", "forest", "water"]));
  });
});

describe("crossingEntryCount", () => {
  function flatTiles(terrain: TerrainType): Tile[] {
    const tiles: Tile[] = [];
    for (let y = 0; y < 31; y++) {
      for (let x = 0; x < 30; x++) {
        tiles.push({ position: { x, y }, terrain });
      }
    }
    return tiles;
  }

  it("counts the whole south row when everything is passable", () => {
    expect(crossingEntryCount(flatTiles("plains"))).toBe(30);
  });

  it("counts zero when the north row cannot seed the fill", () => {
    expect(crossingEntryCount(flatTiles("water"))).toBe(0);
  });

  it("counts zero when a water wall seals the board", () => {
    const tiles = flatTiles("plains");
    for (let x = 0; x < 30; x++) {
      tiles[tileIndex(x, 15)] = { position: { x, y: 15 }, terrain: "water" };
    }
    expect(crossingEntryCount(tiles)).toBe(0);
  });

  it("counts the whole south row when one gap breaks the wall", () => {
    const tiles = flatTiles("plains");
    for (let x = 0; x < 30; x++) {
      tiles[tileIndex(x, 15)] = { position: { x, y: 15 }, terrain: "water" };
    }
    tiles[tileIndex(15, 15)] = {
      position: { x: 15, y: 15 },
      terrain: "plains",
    };
    expect(crossingEntryCount(tiles)).toBe(30);
  });
});
