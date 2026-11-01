import { describe, expect, it } from "vitest";
import type { GameState } from "@/lib/game/types";

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

import { GET as stateGet } from "../state/route";
import { POST } from "./route";

// Phase 3 (PICKUP_POWERS_SPEC.md): POST /api/games/[gameId]/pickup-trap
// by direct import, plus the shared placement hook — the setup flip is
// when the pickup is placed, and the feed must never leak it.

installRouteEnv();

function trapUrl(gameId: string, token: string): string {
  return `http://test/api/games/${gameId}/pickup-trap?t=${token}`;
}

/** A playing game where south holds a trap power, pool full, south to move. */
async function trapReadyGame() {
  const game = await createApiGame();
  await driveToPlaying(game);
  await patchRecord(game.gameId, (record) => {
    record.state.currentPlayer = "south";
    record.state.movementPointsLeft = 10;
    record.state.spentThisTurn = {};
    record.state.heldPowers = { north: [], south: ["trap"] };
  });
  return game;
}

/** A tile nothing sits on: plains, no piece, no trap, no box, no pickup. */
function freeTile(state: GameState): { x: number; y: number } {
  const occupied = new Set(
    state.pieces
      .filter((p) => p.status === "active")
      .map((p) => `${p.position.x},${p.position.y}`),
  );
  for (const tile of state.tiles) {
    const key = `${tile.position.x},${tile.position.y}`;
    if (tile.terrain !== "plains") continue;
    if (occupied.has(key)) continue;
    if (state.traps.some((t) => `${t.position.x},${t.position.y}` === key))
      continue;
    if (
      state.mysteryBoxes.some((b) => `${b.position.x},${b.position.y}` === key)
    )
      continue;
    if (
      state.pickups.some((p) => `${p.position.x},${p.position.y}` === key)
    )
      continue;
    return tile.position;
  }
  throw new Error("freeTile: no free plains tile");
}

describe("POST pickup-trap happy path", () => {
  it("places the trap, spends the power and pool, and logs no event", async () => {
    const game = await trapReadyGame();
    const stored = (await getGameStore().load(game.gameId))!;
    const target = freeTile(stored.state);
    const res = await POST(
      postRequest(trapUrl(game.gameId, game.southToken), {
        position: target,
      }),
      paramsFor(game.gameId),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.ok).toBe(true);
    // No feed event: a placement event would tell the opponent a new
    // hidden trap exists.
    expect(body.events).toEqual([]);
    expect(body.outcome).toEqual({ kind: "trap", position: target });
    const placed = body.state.traps.find(
      (t: { position: { x: number; y: number } }) =>
        t.position.x === target.x && t.position.y === target.y,
    );
    expect(placed).toMatchObject({ owner: "south", triggered: false });
    expect(body.state.heldPowers.south).toEqual([]);
    expect(body.state.movementPointsLeft).toBe(7);
  });
});

describe("POST pickup-trap validation", () => {
  it("rejects a malformed body", async () => {
    const game = await trapReadyGame();
    const res = await POST(
      postRequest(trapUrl(game.gameId, game.southToken), {}),
      paramsFor(game.gameId),
    );
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe("malformed-body");
  });

  it("rejects a use with no held power", async () => {
    const game = await trapReadyGame();
    await patchRecord(game.gameId, (record) => {
      record.state.heldPowers = { north: [], south: [] };
    });
    const stored = (await getGameStore().load(game.gameId))!;
    const res = await POST(
      postRequest(trapUrl(game.gameId, game.southToken), {
        position: freeTile(stored.state),
      }),
      paramsFor(game.gameId),
    );
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe("no-power");
  });

  it("rejects a use with too few pool points", async () => {
    const game = await trapReadyGame();
    await patchRecord(game.gameId, (record) => {
      record.state.movementPointsLeft = 2;
    });
    const stored = (await getGameStore().load(game.gameId))!;
    const res = await POST(
      postRequest(trapUrl(game.gameId, game.southToken), {
        position: freeTile(stored.state),
      }),
      paramsFor(game.gameId),
    );
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe("insufficient-points");
  });

  it("rejects an occupied target and a wrong turn", async () => {
    const game = await trapReadyGame();
    const stored = (await getGameStore().load(game.gameId))!;
    const occupied = stored.state.pieces.find(
      (p) => p.status === "active",
    )!.position;
    const res = await POST(
      postRequest(trapUrl(game.gameId, game.southToken), {
        position: occupied,
      }),
      paramsFor(game.gameId),
    );
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe("invalid-target");

    await patchRecord(game.gameId, (record) => {
      record.state.currentPlayer = "north";
    });
    const res2 = await POST(
      postRequest(trapUrl(game.gameId, game.southToken), {
        position: freeTile(stored.state),
      }),
      paramsFor(game.gameId),
    );
    expect(res2.status).toBe(403);
    expect((await jsonOf(res2)).error).toBe("not-your-turn");
  });
});

describe("pickup placement on the setup flip", () => {
  it("places exactly one legal pickup, invisible to both seats", async () => {
    const game = await createApiGame();
    await driveToPlaying(game);
    const stored = (await getGameStore().load(game.gameId))!;
    expect(stored.state.pickups).toHaveLength(1);
    const [pickup] = stored.state.pickups;
    const tile =
      stored.state.tiles[pickup.position.y * 30 + pickup.position.x];
    expect(["plains", "forest"]).toContain(tile.terrain);
    expect(
      (pickup.position.y >= 3 && pickup.position.y <= 14) ||
        (pickup.position.y >= 16 && pickup.position.y <= 27),
    ).toBe(true);
    expect(pickup.position.y).not.toBe(15);
    // The sanitized views both seats poll carry no pickups.
    for (const token of [game.southToken, game.northToken]) {
      const res = await stateGet(
        new Request(
          `http://test/api/games/${game.gameId}/state?t=${token}&version=0&lastEventSeq=0`,
        ),
        paramsFor(game.gameId),
      );
      const body = await jsonOf(res);
      expect(body.state.pickups).toEqual([]);
    }
  });
});
