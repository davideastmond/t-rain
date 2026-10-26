import { describe, expect, it } from "vitest";
import type { NetEvent } from "@/lib/net/store";

import {
  createApiGame,
  installRouteEnv,
  jsonOf,
  paramsFor,
  patchRecord,
} from "@/lib/net/route-test-helpers";

import { GET } from "./route";

// Phase 2b (TEST_PLAN.md): GET /api/games/[gameId]/state by direct
// import — auth, versioned polling, the lobby join, and clock expiry.

installRouteEnv();

function stateUrl(gameId: string, token: string, extra = ""): string {
  return `http://test/api/games/${gameId}/state?t=${token}${extra}`;
}

describe("GET state auth", () => {
  it("returns 404 for an unknown game and 401 for missing/bad tokens", async () => {
    const game = await createApiGame();
    expect(
      (await GET(new Request(stateUrl("nope", "tok")), paramsFor("nope")))
        .status,
    ).toBe(404);
    expect(
      (
        await GET(
          new Request(stateUrl(game.gameId, "")),
          paramsFor(game.gameId),
        )
      ).status,
    ).toBe(401);
    const bad = await GET(
      new Request(stateUrl(game.gameId, "deadbeef")),
      paramsFor(game.gameId),
    );
    expect(bad.status).toBe(401);
    expect((await jsonOf(bad)).error).toBe("invalid-token");
  });
});

describe("GET state polling", () => {
  it("returns the full view on a fresh poll", async () => {
    const game = await createApiGame();
    const res = await GET(
      new Request(stateUrl(game.gameId, game.southToken)),
      paramsFor(game.gameId),
    );
    const body = await jsonOf(res);
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      changed: true,
      version: 1,
      seat: "south",
      opponentSeenAgoSec: null,
    });
    expect(body.state.phase).toBe("setup");
    expect(body.events.map((e: NetEvent) => e.type)).toEqual(["game-created"]);
  });

  it("returns a light response when the client version matches", async () => {
    const game = await createApiGame();
    const res = await GET(
      new Request(stateUrl(game.gameId, game.southToken, "&version=1")),
      paramsFor(game.gameId),
    );
    const body = await jsonOf(res);
    expect(body.changed).toBe(false);
    expect(body.version).toBe(1);
    expect(body).not.toHaveProperty("state");
  });

  it("filters events by lastEventSeq", async () => {
    const game = await createApiGame();
    const res = await GET(
      new Request(stateUrl(game.gameId, game.southToken, "&lastEventSeq=1")),
      paramsFor(game.gameId),
    );
    expect((await jsonOf(res)).events).toEqual([]);
  });
});

describe("GET state lobby join", () => {
  it("starts the setup clock on north's first request and bumps the version", async () => {
    const game = await createApiGame();
    const res = await GET(
      new Request(stateUrl(game.gameId, game.northToken)),
      paramsFor(game.gameId),
    );
    const body = await jsonOf(res);
    expect(body.version).toBe(2);
    expect(body.setupEndsAt).not.toBeNull();
    expect(body.events.map((e: NetEvent) => e.type)).toEqual([
      "game-created",
      "player-joined",
    ]);
    // A second poll sees the joined state, and the version matches.
    const again = await GET(
      new Request(stateUrl(game.gameId, game.northToken, "&version=2")),
      paramsFor(game.gameId),
    );
    expect((await jsonOf(again)).changed).toBe(false);
  });

  it("reports opponent presence once the opponent has joined", async () => {
    const game = await createApiGame();
    await GET(
      new Request(stateUrl(game.gameId, game.northToken)),
      paramsFor(game.gameId),
    );
    const res = await GET(
      new Request(stateUrl(game.gameId, game.southToken)),
      paramsFor(game.gameId),
    );
    const body = await jsonOf(res);
    expect(typeof body.opponentSeenAgoSec).toBe("number");
    expect(body.opponentSeenAgoSec).toBeGreaterThanOrEqual(0);
  });
});

describe("GET state clock expiry", () => {
  it("auto-places through a poll when the clock has expired", async () => {
    const game = await createApiGame();
    await patchRecord(game.gameId, (record) => {
      record.setupEndsAt = new Date(Date.now() - 1000).toISOString();
    });
    const res = await GET(
      new Request(stateUrl(game.gameId, game.southToken)),
      paramsFor(game.gameId),
    );
    const body = await jsonOf(res);
    expect(body.state.phase).toBe("playing");
    expect(body.state.pieces).toHaveLength(30);
  });
});
