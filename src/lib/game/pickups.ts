// Pickup powers (PICKUP_POWERS_SPEC.md): one invisible item per game,
// randomly a trap or a terraform, collected by stepping onto it and
// usable only the turn it was collected.
//
// Placement is deliberately NOT part of createGame: it runs as a
// separate step when the game flips from setup to playing, with an
// injected rng (Math.random for local games, server random online, the
// battle runner's seeded rng in the lab), so the seeded board
// generation stays pure and replays reconstruct the placement from the
// log instead of re-rolling it.

import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  NEUTRAL_ROW,
  PICKUP_POWER_COST,
  SETUP_ROWS,
} from "./constants";
import { tileIndex } from "./board";
import type { GameState, PickupPowerKind, PlayerId, Position } from "./types";

function samePosition(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y;
}

function inBounds(position: Position): boolean {
  return (
    position.x >= 0 &&
    position.x < BOARD_WIDTH &&
    position.y >= 0 &&
    position.y < BOARD_HEIGHT
  );
}

/**
 * Place the game's single pickup, if the game has none yet. Only valid
 * once the game is playing (placement runs at the setup→playing flip,
 * when the trap/box layout is final). Returns the game unchanged when
 * there is nowhere legal to put it.
 */
export function placePickup(
  state: GameState,
  rng: () => number,
): { state: GameState; placed: boolean } {
  if (state.phase !== "playing" || state.pickups.length > 0) {
    return { state, placed: false };
  }
  const occupied = (position: Position): boolean =>
    state.pieces.some(
      (piece) =>
        piece.status === "active" && samePosition(piece.position, position),
    ) ||
    state.traps.some((trap) => samePosition(trap.position, position)) ||
    state.mysteryBoxes.some((box) => samePosition(box.position, position));
  // Outside both back-3 rows, never the neutral row, land only, and
  // never under a placed piece, a trap, or a box.
  const eligible = state.tiles.filter(
    (tile) =>
      (tile.terrain === "plains" || tile.terrain === "forest") &&
      tile.position.y >= SETUP_ROWS &&
      tile.position.y <= BOARD_HEIGHT - 1 - SETUP_ROWS &&
      tile.position.y !== NEUTRAL_ROW &&
      !occupied(tile.position),
  );
  if (eligible.length === 0) return { state, placed: false };
  const tile = eligible[Math.floor(rng() * eligible.length)];
  const kind: PickupPowerKind = rng() < 0.5 ? "trap" : "terraform";
  return {
    state: { ...state, pickups: [{ position: tile.position, kind }] },
    placed: true,
  };
}

/** Why a pickup power use was refused. The UI turns these into sentences. */
export type PickupPowerError =
  | "wrong-phase"
  | "not-your-turn"
  | "no-power"
  | "insufficient-points"
  | "invalid-target";

export type PickupPowerValidation =
  | { ok: true }
  | { ok: false; error: PickupPowerError };

type PickupPowerResult =
  | { ok: true; state: GameState }
  | { ok: false; error: PickupPowerError };

function checkUse(
  state: GameState,
  player: PlayerId,
  kind: PickupPowerKind,
): PickupPowerValidation {
  if (state.phase !== "playing") return { ok: false, error: "wrong-phase" };
  if (state.currentPlayer !== player)
    return { ok: false, error: "not-your-turn" };
  if (!state.heldPowers[player].includes(kind))
    return { ok: false, error: "no-power" };
  if (state.movementPointsLeft < PICKUP_POWER_COST)
    return { ok: false, error: "insufficient-points" };
  return { ok: true };
}

/** Remove one held power of the given kind from the player's hand. */
function spendPower(
  state: GameState,
  player: PlayerId,
  kind: PickupPowerKind,
): Record<PlayerId, PickupPowerKind[]> {
  const held = state.heldPowers[player];
  const index = held.indexOf(kind);
  return {
    ...state.heldPowers,
    [player]: held.filter((_, i) => i !== index),
  };
}

/**
 * Can the player place their held trap power on `target`? Anywhere
 * targeting: any tile with no active piece, no existing trap, and no
 * uncollected mystery box. Water is allowed (it fires only on a bridged
 * entry); goal rows are allowed, like setup traps.
 */
export function canPlacePickupTrap(
  state: GameState,
  player: PlayerId,
  target: Position,
): PickupPowerValidation {
  const check = checkUse(state, player, "trap");
  if (!check.ok) return check;
  if (
    !inBounds(target) ||
    state.pieces.some(
      (piece) =>
        piece.status === "active" && samePosition(piece.position, target),
    ) ||
    state.traps.some((trap) => samePosition(trap.position, target)) ||
    state.mysteryBoxes.some(
      (box) => !box.collected && samePosition(box.position, target),
    )
  ) {
    return { ok: false, error: "invalid-target" };
  }
  return { ok: true };
}

/**
 * Place a held trap power: it joins the trap array and behaves exactly
 * like a setup trap from then on (hidden, trap-sense-revealed,
 * post-game-revealed, fires on entry). It bypasses the 10-trap setup
 * cap — it is a bonus trap, not a setup trap.
 */
export function applyPickupTrap(
  state: GameState,
  player: PlayerId,
  target: Position,
): PickupPowerResult {
  const check = canPlacePickupTrap(state, player, target);
  if (!check.ok) return check;
  return {
    ok: true,
    state: {
      ...state,
      traps: [
        ...state.traps,
        { owner: player, position: target, triggered: false },
      ],
      heldPowers: spendPower(state, player, "trap"),
      movementPointsLeft: state.movementPointsLeft - PICKUP_POWER_COST,
    },
  };
}

/**
 * Can the player terraform `target`? Any water or forest tile. Plains
 * is invalid (already cost 1 — nothing to change). A trap, box, or
 * piece on the tile is unaffected by the change.
 */
export function canTerraform(
  state: GameState,
  player: PlayerId,
  target: Position,
): PickupPowerValidation {
  const check = checkUse(state, player, "terraform");
  if (!check.ok) return check;
  if (!inBounds(target)) return { ok: false, error: "invalid-target" };
  const terrain = state.tiles[tileIndex(target.x, target.y)].terrain;
  if (terrain !== "water" && terrain !== "forest")
    return { ok: false, error: "invalid-target" };
  return { ok: true };
}

/**
 * Turn one water or forest tile into plains, permanently. The board's
 * 180° mirror breaks; that is cosmetic only, since pathing reads live
 * tiles.
 */
export function applyTerraform(
  state: GameState,
  player: PlayerId,
  target: Position,
): PickupPowerResult {
  const check = canTerraform(state, player, target);
  if (!check.ok) return check;
  const tiles = [...state.tiles];
  tiles[tileIndex(target.x, target.y)] = {
    ...tiles[tileIndex(target.x, target.y)],
    terrain: "plains",
  };
  return {
    ok: true,
    state: {
      ...state,
      tiles,
      heldPowers: spendPower(state, player, "terraform"),
      movementPointsLeft: state.movementPointsLeft - PICKUP_POWER_COST,
    },
  };
}
