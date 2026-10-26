import { describe, expect, it } from "vitest";
import type { NetEvent } from "@/lib/net/store";

import {
  createApiGame,
  driveToPlaying,
  installRouteEnv,
  jsonOf,
  paramsFor,
  postRequest,
} from "@/lib/net/route-test-helpers";

import { POST } from "./route";

// Phase 2b (TEST_PLAN.md): POST /api/games/[gameId]/forfeit by direct import.

installRouteEnv();

function forfeitUrl(gameId: string, token: string): string {
  return `http://test/api/games/${gameId}/forfeit?t=${token}`;
}

describe("POST forfeit", () => {
  it("finishes the game with the other seat as winner", async () => {
    const game = await createApiGame();
    const res = await POST(
      postRequest(forfeitUrl(game.gameId, game.southToken)),
      paramsFor(game.gameId),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.ok).toBe(true);
    expect(body.state.phase).toBe("finished");
    expect(body.state.winner).toBe("north");
    expect(body.events.map((e: NetEvent) => e.type)).toEqual([
      "forfeited",
      "game-finished",
    ]);
  });

  it("rejects a second forfeit once the game is finished", async () => {
    const game = await createApiGame();
    await driveToPlaying(game);
    await POST(
      postRequest(forfeitUrl(game.gameId, game.southToken)),
      paramsFor(game.gameId),
    );
    const again = await POST(
      postRequest(forfeitUrl(game.gameId, game.northToken)),
      paramsFor(game.gameId),
    );
    expect(again.status).toBe(403);
    expect((await jsonOf(again)).error).toBe("wrong-phase");
  });

  it("returns 401 for a bad token", async () => {
    const game = await createApiGame();
    const res = await POST(
      postRequest(forfeitUrl(game.gameId, "deadbeef")),
      paramsFor(game.gameId),
    );
    expect(res.status).toBe(401);
  });
});
