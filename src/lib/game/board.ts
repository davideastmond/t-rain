// Board generation: turn a seed into a board.
//
// A generated board has three guarantees (see SPEC.md):
// 1. It is *determined by the seed* — same seed, same board, every time.
// 2. It is *mirrored* — the terrain at (x, y) always equals the terrain at
//    the 180°-rotated position, so both players face the same board flipped.
// 3. It is *crossable* — water can slow you down, but it can never seal the
//    board. Generation retries until the crossing check passes.

import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  FOREST_PERCENT,
  MIN_CROSSING_ENTRIES,
  WATER_PERCENT,
} from "./constants";
import { createSeededRng, type SeededRng } from "./rng";
import { TERRAIN_INFO, type BiomeId, type Position, type TerrainType, type Tile } from "./types";

const BIOMES: BiomeId[] = ["grass", "desert", "ice"];

/** What generateBoard returns: the tiles, and the biome the seed picked for this game. */
export interface GeneratedBoard {
  biome: BiomeId;
  tiles: Tile[];
}

/**
 * The index of a position in the tiles array. This is the one place the
 * "index = y * width + x" layout from types.ts is written down; everything
 * else goes through here.
 */
export function tileIndex(x: number, y: number): number {
  return y * BOARD_WIDTH + x;
}

/** The position a tile is mirrored to: the same board rotated 180°. */
export function mirrorPosition(position: Position): Position {
  return {
    x: BOARD_WIDTH - 1 - position.x,
    y: BOARD_HEIGHT - 1 - position.y,
  };
}

/** Draw one terrain type, using the percentages from constants.ts. */
function rollTerrain(rng: SeededRng): TerrainType {
  const roll = rng() * 100;
  if (roll < WATER_PERCENT) return "water";
  if (roll < WATER_PERCENT + FOREST_PERCENT) return "forest";
  return "plains";
}

/**
 * Roll a full board of terrain, mirrored.
 *
 * We walk every position, but only *roll* for a tile whose mirror hasn't
 * already been set: rolling a tile immediately writes the same terrain into
 * its mirror slot, so when the walk later reaches that slot it is skipped.
 * (No tile is ever its own mirror — the board is an even number of tiles
 * wide, so x never equals its own mirror.)
 */
function rollTiles(rng: SeededRng): Tile[] {
  const tiles: Tile[] = new Array<Tile>(BOARD_WIDTH * BOARD_HEIGHT);

  for (let y = 0; y < BOARD_HEIGHT; y++) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      const index = tileIndex(x, y);
      if (tiles[index]) continue; // already filled as the mirror of an earlier tile

      const terrain = rollTerrain(rng);
      tiles[index] = { position: { x, y }, terrain };

      const mirror = mirrorPosition({ x, y });
      tiles[tileIndex(mirror.x, mirror.y)] = { position: mirror, terrain };
    }
  }

  return tiles;
}

/**
 * How many tiles on the far back row a crossing can actually reach.
 *
 * Flood fill (breadth-first search) from every passable tile on the north
 * back row, spreading 4-directionally through passable terrain — the same
 * directions pieces move. However tangled the water is, if this count is
 * high enough, real routes across the board exist.
 */
export function crossingEntryCount(tiles: Tile[]): number {
  const visited = new Array<boolean>(tiles.length).fill(false);
  const queue: number[] = [];

  // Seed the fill with the whole north back row (y = 0).
  for (let x = 0; x < BOARD_WIDTH; x++) {
    const index = tileIndex(x, 0);
    if (TERRAIN_INFO[tiles[index].terrain].passable) {
      visited[index] = true;
      queue.push(index);
    }
  }

  // `head` walks the queue instead of shift(), which would copy the array
  // on every step. Pushing while iterating is exactly how BFS expands.
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head];
    const x = index % BOARD_WIDTH;
    const y = Math.floor(index / BOARD_WIDTH);

    const neighbours: Array<[number, number]> = [
      [x, y - 1],
      [x, y + 1],
      [x - 1, y],
      [x + 1, y],
    ];
    for (const [nx, ny] of neighbours) {
      if (nx < 0 || nx >= BOARD_WIDTH || ny < 0 || ny >= BOARD_HEIGHT) continue;
      const nIndex = tileIndex(nx, ny);
      if (visited[nIndex]) continue;
      if (!TERRAIN_INFO[tiles[nIndex].terrain].passable) continue;
      visited[nIndex] = true;
      queue.push(nIndex);
    }
  }

  // Count the reached tiles on the south back row (y = BOARD_HEIGHT - 1).
  let count = 0;
  for (let x = 0; x < BOARD_WIDTH; x++) {
    if (visited[tileIndex(x, BOARD_HEIGHT - 1)]) count++;
  }
  return count;
}

/**
 * Generate the board for a game.
 *
 * The biome is the stream's first draw, then terrain is rolled. If the
 * board fails the crossing check it is discarded and rolled again from the
 * *same* stream — so a seed still maps to exactly one board, it just may
 * have needed more than one roll to get there.
 */
export function generateBoard(seed: number): GeneratedBoard {
  const rng = createSeededRng(seed);
  const biome = BIOMES[Math.floor(rng() * BIOMES.length)];

  let tiles = rollTiles(rng);
  while (crossingEntryCount(tiles) < MIN_CROSSING_ENTRIES) {
    tiles = rollTiles(rng);
  }

  return { biome, tiles };
}
