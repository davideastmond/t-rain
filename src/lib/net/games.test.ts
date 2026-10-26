import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { autoPlaceSetup } from "@/lib/game/setup";

import {
  appendEvent,
  createNetGame,
  gameLink,
  getGameStore,
  hashToken,
  maybeAutoPlaceSetup,
  sanitizeForNetPlayer,
} from "./games";
import { InMemoryGameStore, MAX_EVENTS, type NetEvent } from "./store";

// Phase 2a (TEST_PLAN.md): net lifecycle helpers. The store here is the
// module-level in-memory singleton (MONGODB_URI stubbed empty), so
// every test uses fresh gameIds for isolation.

beforeEach(() => {
  vi.stubEnv("MONGODB_URI", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hashToken", () => {
  it("is deterministic, hex, and collision-free for distinct inputs", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });
});

describe("createNetGame", () => {
  it("builds a fresh setup-phase game with two seats and one event", () => {
    const { record, tokens } = createNetGame();
    expect(record.version).toBe(1);
    expect(record.state.phase).toBe("setup");
    expect(record.state.mysteryBoxes).toHaveLength(2);
    expect(record.events).toEqual([
      {
        seq: 1,
        at: expect.any(String),
        type: "game-created",
      },
    ]);
    expect(record.gameId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    // South has opened (created) the game; north has not yet.
    expect(record.seats.south.lastSeenAt).not.toBeNull();
    expect(record.seats.north.lastSeenAt).toBeNull();
    expect(record.setupEndsAt).toBeNull();
    // Tokens are raw bearer secrets; only their hashes are stored.
    expect(tokens.south).toMatch(/^[0-9a-f]{64}$/);
    expect(tokens.north).toMatch(/^[0-9a-f]{64}$/);
    expect(tokens.south).not.toBe(tokens.north);
    expect(record.seats.south.tokenHash).toBe(hashToken(tokens.south));
    expect(record.seats.north.tokenHash).toBe(hashToken(tokens.north));
  });
});

describe("gameLink", () => {
  it("builds a per-seat link from BASE_URL", () => {
    const original = process.env.BASE_URL;
    try {
      process.env.BASE_URL = "https://example.com";
      expect(gameLink("g1", "tok")).toBe(
        "https://example.com/game/g1?t=tok",
      );
    } finally {
      if (original === undefined) delete process.env.BASE_URL;
      else process.env.BASE_URL = original;
    }
  });

  it("throws when BASE_URL is unset", () => {
    const original = process.env.BASE_URL;
    try {
      delete process.env.BASE_URL;
      expect(() => gameLink("g1", "tok")).toThrow("BASE_URL");
    } finally {
      if (original !== undefined) process.env.BASE_URL = original;
    }
  });
});

describe("sanitizeForNetPlayer", () => {
  it("hides the opponent's pieces during setup, shows them once playing", () => {
    const { record } = createNetGame();
    const south = autoPlaceSetup(record.state, "south");
    expect(south.ok).toBe(true);
    if (!south.ok) return;
    const north = autoPlaceSetup(south.state, "north");
    expect(north.ok).toBe(true);
    if (!north.ok) return;
    // Still in setup for the hiding check: force the phase back.
    const setupState = { ...north.state, phase: "setup" as const };
    expect(
      sanitizeForNetPlayer(setupState, "south").pieces.every(
        (p) => p.owner === "south",
      ),
    ).toBe(true);
    expect(
      sanitizeForNetPlayer(setupState, "north").pieces.every(
        (p) => p.owner === "north",
      ),
    ).toBe(true);
    expect(
      sanitizeForNetPlayer(north.state, "south").pieces,
    ).toHaveLength(30);
  });

  it("still hides unrevealed opponent traps in both phases", () => {
    const { record } = createNetGame();
    const withTraps = {
      ...record.state,
      traps: [
        { owner: "south" as const, position: { x: 5, y: 5 }, triggered: false },
        { owner: "north" as const, position: { x: 6, y: 6 }, triggered: false },
      ],
    };
    const view = sanitizeForNetPlayer(withTraps, "south");
    expect(view.traps.map((t) => t.position)).toEqual([{ x: 5, y: 5 }]);
  });
});

describe("appendEvent", () => {
  it("assigns increasing seqs without mutating the record", () => {
    const { record } = createNetGame();
    const next = appendEvent(record, { type: "turn-ended", player: "south" });
    expect(record.events).toHaveLength(1);
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({
      seq: 2,
      at: expect.any(String),
      type: "turn-ended",
      player: "south",
    });
  });

  it("caps the log at MAX_EVENTS, dropping the oldest", () => {
    const { record } = createNetGame();
    const now = new Date().toISOString();
    const full: NetEvent[] = Array.from({ length: MAX_EVENTS }, (_, i) => ({
      seq: i + 1,
      at: now,
      type: "turn-ended",
      player: "south",
    }));
    const capped = appendEvent(
      { ...record, events: full },
      { type: "turn-ended", player: "north" },
    );
    expect(capped).toHaveLength(MAX_EVENTS);
    expect(capped[0].seq).toBe(2);
    expect(capped[capped.length - 1].seq).toBe(MAX_EVENTS + 1);
  });
});

describe("maybeAutoPlaceSetup", () => {
  it("leaves non-setup games alone", () => {
    const { record } = createNetGame();
    const playing = { ...record, state: { ...record.state, phase: "playing" as const } };
    const { changed } = maybeAutoPlaceSetup(playing);
    expect(changed).toBe(false);
  });

  it("leaves setup games alone before the clock expires", () => {
    const { record } = createNetGame();
    expect(maybeAutoPlaceSetup(record).changed).toBe(false);
    const future = {
      ...record,
      setupEndsAt: new Date(Date.now() + 60_000).toISOString(),
    };
    expect(maybeAutoPlaceSetup(future).changed).toBe(false);
  });

  it("auto-places both missing seats once the clock expires", () => {
    const { record } = createNetGame();
    const expired = {
      ...record,
      setupEndsAt: new Date(Date.now() - 1000).toISOString(),
    };
    const { record: placed, changed } = maybeAutoPlaceSetup(expired);
    expect(changed).toBe(true);
    expect(placed.state.pieces).toHaveLength(30);
    expect(placed.state.traps).toHaveLength(20);
    expect(placed.state.phase).toBe("playing");
    expect(placed.events.map((e) => e.type)).toEqual([
      "game-created",
      "setup-submitted",
      "setup-submitted",
    ]);
    expect(
      placed.events
        .filter((e) => e.type === "setup-submitted")
        .map((e) => (e as { player: string }).player),
    ).toEqual(["south", "north"]);
    // Pure: the input record is untouched, and the result is stable.
    expect(expired.state.pieces).toHaveLength(0);
    expect(maybeAutoPlaceSetup(placed).changed).toBe(false);
  });

  it("auto-places only the seat that never submitted", () => {
    const { record } = createNetGame();
    const south = autoPlaceSetup(record.state, "south");
    expect(south.ok).toBe(true);
    if (!south.ok) return;
    const expired = {
      ...record,
      state: south.state,
      setupEndsAt: new Date(Date.now() - 1000).toISOString(),
    };
    const { record: placed, changed } = maybeAutoPlaceSetup(expired);
    expect(changed).toBe(true);
    expect(placed.state.phase).toBe("playing");
    expect(
      placed.events.filter((e) => e.type === "setup-submitted"),
    ).toHaveLength(1);
  });
});

describe("getGameStore", () => {
  it("returns the same in-memory store without MONGODB_URI", async () => {
    const a = getGameStore();
    const b = getGameStore();
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(InMemoryGameStore);
    const { record } = createNetGame();
    await a.create(record);
    expect(await b.load(record.gameId)).toEqual(record);
  });
});
