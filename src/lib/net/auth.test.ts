import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateGameRequest } from "./auth";
import { createNetGame, getGameStore } from "./games";

// Phase 2a (TEST_PLAN.md): seat-token authentication against the
// in-memory store (MONGODB_URI stubbed empty). Each test creates its
// own game, so the shared module-level store never cross-contaminates.

beforeEach(() => {
  vi.stubEnv("MONGODB_URI", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function makeGame() {
  const store = getGameStore();
  const { record, tokens } = createNetGame();
  await store.create(record);
  return { store, record, tokens };
}

describe("authenticateGameRequest", () => {
  it("returns 404 for an unknown game", async () => {
    expect(await authenticateGameRequest("nope", "tok")).toEqual({
      ok: false,
      status: 404,
      error: "game-not-found",
    });
  });

  it("returns 401 for a missing token", async () => {
    const { record } = await makeGame();
    expect(await authenticateGameRequest(record.gameId, null)).toEqual({
      ok: false,
      status: 401,
      error: "missing-token",
    });
  });

  it("returns 401 for a token that matches neither seat", async () => {
    const { record } = await makeGame();
    expect(
      await authenticateGameRequest(record.gameId, "deadbeef"),
    ).toEqual({
      ok: false,
      status: 401,
      error: "invalid-token",
    });
  });

  it("authenticates each seat by its own token", async () => {
    const { record, tokens } = await makeGame();
    const south = await authenticateGameRequest(record.gameId, tokens.south);
    expect(south.ok).toBe(true);
    if (!south.ok) return;
    expect(south.ctx.seat).toBe("south");
    expect(south.ctx.record.gameId).toBe(record.gameId);
    const north = await authenticateGameRequest(record.gameId, tokens.north);
    expect(north.ok).toBe(true);
    if (!north.ok) return;
    expect(north.ctx.seat).toBe("north");
  });

  it("refreshes presence without bumping the version", async () => {
    const { store, record, tokens } = await makeGame();
    // North starts with no presence, so the refresh is unambiguous.
    await authenticateGameRequest(record.gameId, tokens.north);
    const loaded = (await store.load(record.gameId))!;
    expect(loaded.version).toBe(1);
    expect(loaded.seats.north.lastSeenAt).not.toBeNull();
  });
});
