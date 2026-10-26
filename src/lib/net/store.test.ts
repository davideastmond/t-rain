import { describe, expect, it } from "vitest";

import { createNetGame } from "./games";
import { InMemoryGameStore, type GameRecord } from "./store";

// Phase 2a (TEST_PLAN.md): the in-memory store — the CAS contract the
// server relies on, plus the clone isolation that keeps a loaded
// record from aliasing stored state.

function makeRecord(gameId: string): GameRecord {
  const { record } = createNetGame();
  return { ...record, gameId };
}

describe("InMemoryGameStore create and load", () => {
  it("round-trips a record", async () => {
    const store = new InMemoryGameStore();
    const record = makeRecord("g1");
    await store.create(record);
    const loaded = await store.load("g1");
    expect(loaded).toEqual(record);
    expect(loaded).not.toBe(record);
  });

  it("returns null for an unknown game", async () => {
    const store = new InMemoryGameStore();
    expect(await store.load("nope")).toBeNull();
  });

  it("throws on a duplicate gameId", async () => {
    const store = new InMemoryGameStore();
    await store.create(makeRecord("g1"));
    await expect(store.create(makeRecord("g1"))).rejects.toThrow(
      "duplicate gameId",
    );
  });

  it("isolates stored state from later mutation of the created record", async () => {
    const store = new InMemoryGameStore();
    const record = makeRecord("g1");
    await store.create(record);
    record.state.scores.north = 99;
    expect((await store.load("g1"))!.state.scores.north).toBe(0);
  });

  it("isolates stored state from mutation of a loaded record", async () => {
    const store = new InMemoryGameStore();
    await store.create(makeRecord("g1"));
    const loaded = (await store.load("g1"))!;
    loaded.state.scores.south = 99;
    expect((await store.load("g1"))!.state.scores.south).toBe(0);
  });
});

describe("InMemoryGameStore save (compare-and-swap)", () => {
  it("succeeds on a version match and bumps the version", async () => {
    const store = new InMemoryGameStore();
    const record = makeRecord("g1");
    await store.create(record);
    const next = { ...record, state: { ...record.state } };
    expect(await store.save(next, 1)).toBe(true);
    expect((await store.load("g1"))!.version).toBe(2);
  });

  it("rejects a stale version and leaves the stored record untouched", async () => {
    const store = new InMemoryGameStore();
    const record = makeRecord("g1");
    await store.create(record);
    await store.save({ ...record }, 1);
    expect(await store.save({ ...record }, 1)).toBe(false);
    expect((await store.load("g1"))!.version).toBe(2);
  });

  it("returns false for an unknown game instead of creating it", async () => {
    const store = new InMemoryGameStore();
    expect(await store.save(makeRecord("g1"), 1)).toBe(false);
    expect(await store.load("g1")).toBeNull();
  });
});

describe("InMemoryGameStore touchSeat", () => {
  it("sets presence without bumping the version", async () => {
    const store = new InMemoryGameStore();
    await store.create(makeRecord("g1"));
    // North starts with no presence: the null → timestamp transition
    // is unambiguous (no same-millisecond flakiness).
    await store.touchSeat("g1", "north");
    const loaded = (await store.load("g1"))!;
    expect(loaded.version).toBe(1);
    expect(loaded.seats.north.lastSeenAt).not.toBeNull();
  });

  it("ignores an unknown game instead of throwing", async () => {
    const store = new InMemoryGameStore();
    await expect(store.touchSeat("nope", "north")).resolves.toBeUndefined();
  });
});
