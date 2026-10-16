// Shared UI strings for the game screens.
//
// Both the local game (/local) and the network client (/game/[gameId])
// run the same setup and move flows, so the human-readable messages for
// the engine's error codes — and the player labels — live here instead
// of being declared once per page.

import {
  MAX_NEUTRAL_TRAPS,
  MAX_POINTS_PER_PIECE_PER_TURN,
  PIECES_PER_PLAYER,
  TRAPS_PER_PLAYER,
} from "./constants";
import type { MoveError } from "./movement";
import type { SetupError } from "./setup";
import type { PlayerId } from "./types";

export const SETUP_ERROR_MESSAGES: Record<SetupError, string> = {
  "wrong-phase": "The game isn't in the setup phase.",
  "already-setup": "You've already locked in your setup.",
  "wrong-piece-count": `You need exactly ${PIECES_PER_PLAYER} pieces placed.`,
  "duplicate-character": "Each character can only be placed once.",
  "piece-outside-zone": "Pieces go in your back 3 rows.",
  "wrong-trap-count": `You need exactly ${TRAPS_PER_PLAYER} traps placed.`,
  "trap-outside-zone": "Traps go in your zone or the neutral row.",
  "too-many-neutral-traps": `At most ${MAX_NEUTRAL_TRAPS} traps may go in the neutral row.`,
  "duplicate-position": "That tile is already taken.",
  "on-water": "Nothing can be placed on water.",
};

export const MOVE_ERROR_MESSAGES: Record<MoveError, string> = {
  "wrong-phase": "The game isn't being played right now.",
  "piece-not-found": "That piece doesn't exist.",
  "piece-not-active": "That piece is no longer on the board.",
  "not-your-turn": "It's not your turn.",
  "not-adjacent": "Pieces step one tile up, down, left, or right.",
  "on-water": "Pieces can't enter water.",
  occupied: "That tile is occupied — pieces block each other.",
  "exceeds-piece-cap": `A piece can spend at most ${MAX_POINTS_PER_PIECE_PER_TURN} points per turn.`,
  "insufficient-points": "Not enough movement points left in this turn's pool.",
};

export function playerLabel(player: PlayerId): string {
  return player === "north" ? "North" : "South";
}
