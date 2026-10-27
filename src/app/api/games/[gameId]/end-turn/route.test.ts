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

// Phase 2b (TEST_PLAN.md): POST /api/games/[gameId]/end-turn by direct import.

installRouteEnv();

function endTurnUrl(gameId: string, token: string): string {
  return `http://test/api/games/${gameId}/end-turn?t=${token}`;
}

describe("POST end-turn", () => {
  it("passes the turn and logs it", async () => {
    const game = await createApiGame();
    const state = await driveToPlaying(game);
    const seat = state.currentPlayer as "south" | "north";
    const token = seat === "south" ? game.southToken : game.northToken;
    const res = await POST(
      postRequest(endTurnUrl(game.gameId, token)),
      paramsFor(game.gameId),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.ok).toBe(true);
    expect(body.state.currentPlayer).toBe(
      seat === "south" ? "north" : "south",
    );
    expect(body.state.movementPointsLeft).toBe(10);
    expect(body.events.map((e: NetEvent) => e.type)).toEqual(["turn-ended"]);
  });

  it("rejects the wrong seat and the wrong phase", async () => {
    const game = await createApiGame();
    const state = await driveToPlaying(game);
    const seat = state.currentPlayer as "south" | "north";
    const otherToken =
      seat === "south" ? game.northToken : game.southToken;
    const wrongTurn = await POST(
      postRequest(endTurnUrl(game.gameId, otherToken)),
      paramsFor(game.gameId),
    );
    expect(wrongTurn.status).toBe(403);
    expect((await jsonOf(wrongTurn)).error).toBe("not-your-turn");

    const fresh = await createApiGame();
    const wrongPhase = await POST(
      postRequest(endTurnUrl(fresh.gameId, fresh.southToken)),
      paramsFor(fresh.gameId),
    );
    expect(wrongPhase.status).toBe(403);
    expect((await jsonOf(wrongPhase)).error).toBe("wrong-phase");
  });
});
