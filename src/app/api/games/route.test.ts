import { describe, expect, it } from "vitest";

import {
  createApiGame,
  installRouteEnv,
  jsonOf,
} from "@/lib/net/route-test-helpers";
import { getGameStore } from "@/lib/net/games";

import { POST } from "./route";

// Phase 2b (TEST_PLAN.md): POST /api/games by direct import.

installRouteEnv();

describe("POST /api/games", () => {
  it("creates a game and returns the creator's and invite links", async () => {
    const res = await POST();
    expect(res.status).toBe(201);
    const body = await jsonOf(res);
    expect(body.yourSeat).toBe("south");
    expect(body.version).toBe(1);
    expect(body.gameId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.yourLink).toContain(`/game/${body.gameId}?t=`);
    expect(body.inviteLink).toContain(`/game/${body.gameId}?t=`);
    expect(body.yourLink).not.toBe(body.inviteLink);
    // The record behind it is a real setup-phase game.
    const stored = await getGameStore().load(body.gameId);
    expect(stored!.state.phase).toBe("setup");
  });

  it("returns distinct tokens for the two seats", async () => {
    const game = await createApiGame();
    expect(game.southToken).not.toBe(game.northToken);
  });
});
