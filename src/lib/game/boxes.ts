// Mystery boxes (POWERUPS_SPEC.md): generation and the collection roll.
//
// Two boxes per game — one mirrored pair, one in each player's zone —
// generated with the board from the game seed, on their own RNG stream
// so they never perturb board generation. A box is public, and only the
// player whose zone it is *not* in may collect it: stepping onto its
// tile rolls the contents (extra steps / bridge / booby trap) from a
// stream seeded by the game seed and the running roll count, so seed +
// move history reproduces every roll exactly — local, network, and
// battle replays all agree.

import { mirrorPosition } from "./board";
import {
  BOARD_HEIGHT,
  BOX_BRIDGE_CHANCE,
  BOX_EXTRA_STEPS_CHANCE,
  NEUTRAL_ROW,
  SETUP_ROWS,
} from "./constants";
import { createSeededRng } from "./rng";
import {
  TERRAIN_INFO,
  type GameState,
  type MysteryBox,
  type MysteryBoxOutcome,
  type PlayerId,
  type Position,
  type Tile,
} from "./types";

function samePosition(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * The pair for a fresh game: one box on a passable tile in the south
 * zone (outside the back SETUP_ROWS rows, off the neutral row), and its
 * 180° mirror in the north zone — which lands outside the north setup
 * rows and off the goal row by the same constraints.
 */
export function generateMysteryBoxes(seed: number, tiles: Tile[]): MysteryBox[] {
  const rng = createSeededRng(seed + 303);
  const candidates = tiles.filter(
    (tile) =>
      tile.position.y > NEUTRAL_ROW &&
      tile.position.y < BOARD_HEIGHT - SETUP_ROWS &&
      TERRAIN_INFO[tile.terrain].passable,
  );
  const pick = candidates[Math.floor(rng() * candidates.length)];
  return [
    { position: pick.position, collected: false },
    { position: mirrorPosition(pick.position), collected: false },
  ];
}

/** The box on a tile, if there is one (collected or not). */
export function mysteryBoxAt(
  state: GameState,
  position: Position,
): MysteryBox | undefined {
  return state.mysteryBoxes.find((box) => samePosition(box.position, position));
}

/**
 * Who may collect the box at `position`: the player whose zone it is
 * not in. Boxes never sit on the neutral row, so this is total.
 */
export function boxCollector(position: Position): PlayerId {
  return position.y > NEUTRAL_ROW ? "north" : "south";
}

/**
 * Roll the contents of the game's next collected box. The stream is
 * seeded from the game seed and how many boxes have already been
 * rolled, keeping the whole game reproducible from its move history.
 */
export function rollMysteryBox(state: GameState): MysteryBoxOutcome {
  const roll = createSeededRng(state.seed + 404 + state.boxRolls)();
  if (roll < BOX_EXTRA_STEPS_CHANCE) return "extra-steps";
  if (roll < BOX_EXTRA_STEPS_CHANCE + BOX_BRIDGE_CHANCE) return "bridge";
  return "booby-trap";
}
