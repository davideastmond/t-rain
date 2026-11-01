// Net game storage: the GameStore interface plus record types.
//
// The server is authoritative: one GameRecord per game holds the full
// GameState (including *both* players' untriggered traps — it is never
// sent to a client unfiltered). Every mutation goes through
// save(record, expectedVersion), which implementations treat as an
// atomic compare-and-swap on `version`: if two requests race, one wins
// and the other gets `false` back and must re-read. The in-memory
// implementation below is for local dev and tests; MongoDB is the
// production backend (see mongo.ts).

import type {
  GameState,
  MysteryBoxOutcome,
  PlayerId,
  Position,
} from "@/lib/game/types";

// ---- Events ----
// The per-game feed clients use for narration/animation. Filtered per
// player on read (trap events only ever reference triggered traps).
// Grows as endpoints land; each entry carries a per-game `seq`.
export interface NetEventBase {
  seq: number;
  at: string; // ISO timestamp
}

export type NetEvent =
  | (NetEventBase & { type: "game-created" })
  | (NetEventBase & { type: "player-joined"; player: PlayerId })
  | (NetEventBase & { type: "setup-submitted"; player: PlayerId })
  | (NetEventBase & {
      type: "step";
      pieceId: string;
      from: Position;
      to: Position;
      cost: number;
    })
  | (NetEventBase & {
      type: "trap-triggered";
      position: Position;
      victimPieceId: string;
    })
  | (NetEventBase & {
      type: "scored";
      pieceId: string;
      player: PlayerId;
      scores: Record<PlayerId, number>;
    })
  | (NetEventBase & { type: "turn-ended"; player: PlayerId })
  | (NetEventBase & { type: "forfeited"; player: PlayerId })
  | (NetEventBase & {
      type: "nerfed";
      player: PlayerId;
      targetPieceId: string;
    })
  | (NetEventBase & {
      type: "box-collected";
      player: PlayerId;
      pieceId: string;
      outcome: MysteryBoxOutcome;
    })
  | (NetEventBase & {
      /** A terraform use: public, because the tile itself changes on the
          shared board. Trap placements get no event — they stay hidden
          until something steps on them. */
      type: "terraformed";
      player: PlayerId;
      position: Position;
    })
  | (NetEventBase & {
      type: "piece-drowned";
      player: PlayerId;
      pieceId: string;
    })
  | (NetEventBase & {
      type: "game-finished";
      winner: PlayerId;
      reason: "crossed" | "attrition" | "forfeit";
    });
// later: spectators / chat, if ever

/** Cap for the per-game event log. */
export const MAX_EVENTS = 50;

export interface SeatInfo {
  /** sha256 hex of the seat's bearer token. The raw token is never stored. */
  tokenHash: string;
  /**
   * ISO timestamp of the seat's last authenticated request (presence),
   * or null if the seat's link has never been opened. North starts null:
   * their first request is the lobby → setup join.
   */
  lastSeenAt: string | null;
}

export interface GameRecord {
  gameId: string;
  /** Monotonically increasing; bumped by the store on every save. */
  version: number;
  /** Authoritative full state. Never leaves the server unfiltered. */
  state: GameState;
  /** Capped, seq-ordered event log. */
  events: NetEvent[];
  seats: Record<PlayerId, SeatInfo>;
  /** ISO timestamp; set when the setup phase begins (server clock). */
  setupEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GameStore {
  /** Persist a new record. Throws on duplicate gameId. */
  create(record: GameRecord): Promise<void>;
  load(gameId: string): Promise<GameRecord | null>;
  /**
   * Persist a mutated record. Succeeds only if the stored version still
   * equals `expectedVersion`; the stored version becomes
   * `expectedVersion + 1`. Returns false on conflict (caller re-reads
   * and retries).
   */
  save(record: GameRecord, expectedVersion: number): Promise<boolean>;

  /**
   * Refresh a seat's presence timestamp. Deliberately does NOT bump
   * `version`: presence changes every poll and must not invalidate the
   * version cache that makes polling cheap. Last-writer-wins is fine.
   */
  touchSeat(gameId: string, seat: PlayerId): Promise<void>;
}

/** Non-persistent store for local dev and tests. */
export class InMemoryGameStore implements GameStore {
  private games = new Map<string, GameRecord>();

  async create(record: GameRecord): Promise<void> {
    if (this.games.has(record.gameId)) throw new Error("duplicate gameId");
    this.games.set(record.gameId, structuredClone(record));
  }

  async load(gameId: string): Promise<GameRecord | null> {
    const record = this.games.get(gameId);
    return record ? structuredClone(record) : null;
  }

  async save(record: GameRecord, expectedVersion: number): Promise<boolean> {
    const current = this.games.get(record.gameId);
    if (!current || current.version !== expectedVersion) return false;
    const next = structuredClone(record);
    next.version = expectedVersion + 1;
    next.updatedAt = new Date().toISOString();
    this.games.set(record.gameId, next);
    return true;
  }

  async touchSeat(gameId: string, seat: PlayerId): Promise<void> {
    const current = this.games.get(gameId);
    if (!current) return;
    current.seats[seat].lastSeenAt = new Date().toISOString();
    current.updatedAt = current.seats[seat].lastSeenAt;
  }
}
