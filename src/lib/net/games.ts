// Net game lifecycle helpers: creating games, seat tokens, links.
//
// Seats are bearer tokens: whoever holds a seat's link can play that
// seat. The raw token is returned exactly once (in the POST /api/games
// response) and only its sha256 hash is stored — see SeatInfo.

import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";

import { sanitizeForPlayer } from "@/lib/game/cpu";
import { placePickup } from "@/lib/game/pickups";
import { autoPlaceSetup, createGame } from "@/lib/game/setup";
import type {
  GameState,
  MysteryBoxOutcome,
  PlayerId,
  Position,
} from "@/lib/game/types";

import { MongoGameStore } from "./mongo";
import {
  InMemoryGameStore,
  MAX_EVENTS,
  type GameRecord,
  type GameStore,
  type NetEvent,
} from "./store";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

let memoryStore: InMemoryGameStore | null = null;

/**
 * The store for this server instance. MongoDB when MONGODB_URI is set,
 * otherwise an in-memory store (local dev and tests). Module-level, so
 * prefer calling once per request handler rather than caching the
 * result across requests.
 */
export function getGameStore(): GameStore {
  if (process.env.MONGODB_URI) return new MongoGameStore();
  if (!memoryStore) memoryStore = new InMemoryGameStore();
  return memoryStore;
}

export interface CreatedGame {
  record: GameRecord;
  /** Raw bearer tokens — returned once, never stored. */
  tokens: Record<PlayerId, string>;
}

/** A fresh game: random seed (board, biome, first-player draw), two seats. */
export function createNetGame(): CreatedGame {
  const tokens: Record<PlayerId, string> = {
    south: randomBytes(32).toString("hex"),
    north: randomBytes(32).toString("hex"),
  };
  const now = new Date().toISOString();
  const record: GameRecord = {
    gameId: randomUUID(),
    version: 1,
    state: createGame(randomInt(0, 1_000_000_000)),
    events: [{ seq: 1, at: now, type: "game-created" }],
    seats: {
      south: { tokenHash: hashToken(tokens.south), lastSeenAt: now },
      // North hasn't opened their link yet; their first authenticated
      // request is the lobby → setup join (see the state route).
      north: { tokenHash: hashToken(tokens.north), lastSeenAt: null },
    },
    setupEndsAt: null,
    createdAt: now,
    updatedAt: now,
  };
  return { record, tokens };
}

/** Relative per-seat link, e.g. /game/<id>?t=<token>. */
export function gameLink(gameId: string, token: string): string {
  if (!process.env.BASE_URL) {
    throw new Error("BASE_URL is not set or is undefined");
  }
  return `${process.env.BASE_URL}/game/${gameId}?t=${token}`;
}

/**
 * The per-seat view of a game state for the network API. Starts from the
 * CPU-proven sanitizeForPlayer (opponent's untriggered traps stay hidden)
 * and additionally hides the opponent's *pieces* while the game is still
 * in setup — placements are simultaneous, so nothing about either side's
 * draft may leak early.
 */
export function sanitizeForNetPlayer(
  state: GameState,
  seat: PlayerId,
): GameState {
  const filtered = sanitizeForPlayer(state, seat);
  if (state.phase === "setup") {
    return {
      ...filtered,
      pieces: filtered.pieces.filter((piece) => piece.owner === seat),
    };
  }
  return filtered;
}

/** A new event before seq/at are assigned. */
export type NewEvent =
  | { type: "game-created" }
  | { type: "player-joined"; player: PlayerId }
  | { type: "setup-submitted"; player: PlayerId }
  | {
      type: "step";
      pieceId: string;
      from: Position;
      to: Position;
      cost: number;
    }
  | { type: "trap-triggered"; position: Position; victimPieceId: string }
  | {
      type: "scored";
      pieceId: string;
      player: PlayerId;
      scores: Record<PlayerId, number>;
    }
  | { type: "turn-ended"; player: PlayerId }
  | { type: "forfeited"; player: PlayerId }
  | { type: "nerfed"; player: PlayerId; targetPieceId: string }
  | {
      type: "box-collected";
      player: PlayerId;
      pieceId: string;
      outcome: MysteryBoxOutcome;
    }
  | { type: "terraformed"; player: PlayerId; position: Position }
  | { type: "piece-drowned"; player: PlayerId; pieceId: string }
  | {
      type: "game-finished";
      winner: PlayerId;
      reason: "crossed" | "attrition" | "forfeit";
    };

/**
 * Append an event to a record's log: assigns the next seq and timestamp,
 * caps the log at MAX_EVENTS. Returns the new event array (does not
 * mutate the record).
 */
export function appendEvent(record: GameRecord, event: NewEvent): NetEvent[] {
  const seq =
    record.events.length > 0
      ? record.events[record.events.length - 1].seq + 1
      : 1;
  const next: NetEvent[] = [
    ...record.events,
    { ...event, seq, at: new Date().toISOString() },
  ];
  return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
}

/**
 * Resolve an expired setup clock: any seat that never submitted gets the
 * deterministic auto-placement, exactly as if they had timed out in the
 * local game. If the auto-placement flips the game to playing, the
 * pickup is placed too (PICKUP_POWERS_SPEC.md) — the only non-pure step
 * here, using server random; placePickup's own guards make it
 * idempotent, so calling this from any route (polls included) is safe.
 */
export function maybeAutoPlaceSetup(record: GameRecord): {
  record: GameRecord;
  changed: boolean;
} {
  if (record.state.phase !== "setup") return { record, changed: false };
  if (!record.setupEndsAt || Date.now() <= Date.parse(record.setupEndsAt)) {
    return { record, changed: false };
  }
  let state = record.state;
  let events = record.events;
  let changed = false;
  for (const player of ["south", "north"] as PlayerId[]) {
    if (state.pieces.some((piece) => piece.owner === player)) continue;
    const placed = autoPlaceSetup(state, player);
    if (!placed.ok) continue;
    state = placed.state;
    events = appendEvent(
      { ...record, state, events },
      {
        type: "setup-submitted",
        player,
      },
    );
    changed = true;
  }
  if (changed && state.phase === "playing") {
    // The flip is when the pickup is placed: only now is the trap/box
    // layout final. No feed event — a placement event would leak the
    // pickup's position and kind to both seats; it lives in the server
    // state only (the battle log records it, in a later phase).
    state = placePickup(state, Math.random).state;
  }
  return changed
    ? { record: { ...record, state, events }, changed }
    : { record, changed: false };
}
