import { describe, expect, it } from "vitest";
import type { NetEvent } from "@/lib/net/store";
import type { Piece } from "@/lib/game/types";

import { movePieceTo, setTerrain } from "@/lib/game/test-helpers";
import { getGameStore } from "@/lib/net/games";
import {
  createApiGame,
  driveToPlaying,
  installRouteEnv,
  jsonOf,
  paramsFor,
  patchRecord,
  postRequest,
} from "@/lib/net/route-test-helpers";

import { POST } from "./route";

// Phase 2b (TEST_PLAN.md): POST /api/games/[gameId]/nerf by direct
// import. The nerf scenario is arranged by patching the stored record
// (token, adjacency, turn) — the engine already covers nerf rules;
// these tests cover the route's auth, mapping, events, and save.

installRouteEnv();

function nerfUrl(gameId: string, token: string): string {
  return `http://test/api/games/${gameId}/nerf?t=${token}`;
}

/** A playing game where south holds a token and sits next to a north piece. */
async function nerfReadyGame() {
  const game = await createApiGame();
  await driveToPlaying(game);
  await patchRecord(game.gameId, (record) => {
    const foe = record.state.pieces.find(
      (p) => p.owner === "north" && p.status === "active",
    )!;
    const hunter = record.state.pieces.find(
      (p) => p.owner === "south" && p.status === "active",
    )!;
    // Park the hunter on a real neighbouring tile (in-bounds, distance 1).
    const candidates = [
      { x: foe.position.x + 1, y: foe.position.y },
      { x: foe.position.x - 1, y: foe.position.y },
      { x: foe.position.x, y: foe.position.y + 1 },
      { x: foe.position.x, y: foe.position.y - 1 },
    ].filter((p) => p.x >= 0 && p.x < 30 && p.y >= 0 && p.y < 31);
    const spot = candidates[0];
    // The helpers return copies — thread them, don't discard them.
    let state = setTerrain(record.state, spot.x, spot.y, "plains");
    state = movePieceTo(state, hunter.id, spot);
    state.currentPlayer = "south";
    state.movementPointsLeft = 10;
    state.nerfTokens = { north: 0, south: 1 };
    state.nerfTokensPending = { north: 0, south: 0 };
    state.spentThisTurn = {};
    record.state = state;
  });
  return game;
}

describe("POST nerf happy path", () => {
  it("eliminates the target, spends the token and pool, and logs it", async () => {
    const game = await nerfReadyGame();
    const stored = (await getGameStore().load(game.gameId))!;
    const foe = stored.state.pieces.find(
      (p) => p.owner === "north" && p.status === "active",
    )!;
    const hunter = stored.state.pieces.find(
      (p) => p.owner === "south" && p.status === "active",
    )!;
    // Sanity: the fixture really is adjacent.
    const adjacent =
      Math.abs(foe.position.x - hunter.position.x) +
        Math.abs(foe.position.y - hunter.position.y) ===
      1;
    expect(adjacent).toBe(true);
    const res = await POST(
      postRequest(nerfUrl(game.gameId, game.southToken), {
        targetPieceId: foe.id,
      }),
      paramsFor(game.gameId),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.ok).toBe(true);
    expect(body.events.map((e: NetEvent) => e.type)).toEqual(["nerfed"]);
    const target = body.state.pieces.find((p: Piece) => p.id === foe.id);
    expect(target.status).toBe("eliminated");
    expect(body.state.nerfTokens.south).toBe(0);
    expect(body.state.movementPointsLeft).toBe(7);
  });
});

describe("POST nerf validation", () => {
  it("rejects a malformed body", async () => {
    const game = await nerfReadyGame();
    const res = await POST(
      postRequest(nerfUrl(game.gameId, game.southToken), {}),
      paramsFor(game.gameId),
    );
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe("malformed-body");
  });

  it("rejects a nerf with no token", async () => {
    const game = await nerfReadyGame();
    await patchRecord(game.gameId, (record) => {
      record.state.nerfTokens = { north: 0, south: 0 };
    });
    const stored = (await getGameStore().load(game.gameId))!;
    const foe = stored.state.pieces.find((p) => p.owner === "north")!;
    const res = await POST(
      postRequest(nerfUrl(game.gameId, game.southToken), {
        targetPieceId: foe.id,
      }),
      paramsFor(game.gameId),
    );
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe("no-token");
  });

  it("rejects a nerf from the wrong seat", async () => {
    const game = await nerfReadyGame();
    const stored = (await getGameStore().load(game.gameId))!;
    const foe = stored.state.pieces.find((p) => p.owner === "north")!;
    const res = await POST(
      postRequest(nerfUrl(game.gameId, game.northToken), {
        targetPieceId: foe.id,
      }),
      paramsFor(game.gameId),
    );
    expect(res.status).toBe(403);
    expect((await jsonOf(res)).error).toBe("not-your-turn");
  });

  it("rejects an invalid target", async () => {
    const game = await nerfReadyGame();
    const res = await POST(
      postRequest(nerfUrl(game.gameId, game.southToken), {
        targetPieceId: "south-nope",
      }),
      paramsFor(game.gameId),
    );
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe("invalid-target");
  });
});
