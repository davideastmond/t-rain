// Net game lifecycle helpers: creating games, seat tokens, links.
//
// Seats are bearer tokens: whoever holds a seat's link can play that
// seat. The raw token is returned exactly once (in the POST /api/games
// response) and only its sha256 hash is stored — see SeatInfo.

import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";

import { createGame } from "@/lib/game/setup";
import type { PlayerId } from "@/lib/game/types";

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
  return `/game/${gameId}?t=${token}`;
}

/** A new event before seq/at are assigned. */
export type NewEvent =
  | { type: "game-created" }
  | { type: "player-joined"; player: PlayerId };
// later: setup-submitted | step | trap-triggered | scored |
//        turn-ended | game-finished | forfeited

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
  return next.length > MAX_EVENTS
    ? next.slice(next.length - MAX_EVENTS)
    : next;
}
