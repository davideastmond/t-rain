import { describe, expect, it } from "vitest";
import type { NetEvent } from "@/lib/net/store";
import type { Piece } from "@/lib/game/types";

import {
  createApiGame,
  driveToPlaying,
  installRouteEnv,
  jsonOf,
  paramsFor,
  patchRecord,
  postRequest,
  validSetupBody,
} from "@/lib/net/route-test-helpers";
import { getGameStore } from "@/lib/net/games";
import { GET as stateGet } from "@/app/api/games/[gameId]/state/route";

import { POST } from "./route";

// Phase 2b (TEST_PLAN.md): POST /api/games/[gameId]/setup by direct import.

installRouteEnv();

function setupUrl(gameId: string, token: string): string {
  return `http://test/api/games/${gameId}/setup?t=${token}`;
}

async function southState(gameId: string, token: string) {
  const res = await stateGet(
    new Request(
      `http://test/api/games/${gameId}/state?t=${token}`,
    ),
    paramsFor(gameId),
  );
  return (await jsonOf(res)).state;
}

describe("POST setup happy path", () => {
  it("accepts a valid submission and stores it", async () => {
    const game = await createApiGame();
    const state = await southState(game.gameId, game.southToken);
    const res = await POST(
      postRequest(
        setupUrl(game.gameId, game.southToken),
        validSetupBody(state, "south"),
      ),
      paramsFor(game.gameId),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.ok).toBe(true);
    expect(body.version).toBe(2);
    expect(body.events.map((e: NetEvent) => e.type)).toEqual(["setup-submitted"]);
    // During setup the seat sees only its own pieces.
    expect(body.state.pieces).toHaveLength(15);
    expect(body.state.pieces.every((p: Piece) => p.owner === "south")).toBe(true);
  });

  it("flips to playing once both seats submit", async () => {
    const game = await createApiGame();
    const state = await driveToPlaying(game);
    expect(state.phase).toBe("playing");
    expect(state.pieces).toHaveLength(30);
  });

  it("rejects a second submission from the same seat", async () => {
    const game = await createApiGame();
    const state = await southState(game.gameId, game.southToken);
    const body = validSetupBody(state, "south");
    await POST(
      postRequest(setupUrl(game.gameId, game.southToken), body),
      paramsFor(game.gameId),
    );
    const again = await POST(
      postRequest(setupUrl(game.gameId, game.southToken), body),
      paramsFor(game.gameId),
    );
    expect(again.status).toBe(403);
    expect((await jsonOf(again)).error).toBe("already-setup");
  });
});

describe("POST setup validation", () => {
  it("rejects malformed bodies and bad characters", async () => {
    const game = await createApiGame();
    const state = await southState(game.gameId, game.southToken);
    const badBodies: unknown[] = [
      {},
      { pieces: "nope", traps: [] },
      {
        ...validSetupBody(state, "south"),
        pieces: validSetupBody(state, "south").pieces.map((p, i) =>
          i === 0 ? { ...p, character: "dragon" } : p,
        ),
      },
    ];
    for (const bad of badBodies) {
      const res = await POST(
        postRequest(setupUrl(game.gameId, game.southToken), bad),
        paramsFor(game.gameId),
      );
      expect(res.status).toBe(400);
      expect((await jsonOf(res)).error).toBe("malformed-body");
    }
  });

  it("rejects a submission that fails engine validation", async () => {
    const game = await createApiGame();
    const state = await southState(game.gameId, game.southToken);
    const short = validSetupBody(state, "south");
    short.pieces = short.pieces.slice(0, 14);
    const res = await POST(
      postRequest(setupUrl(game.gameId, game.southToken), short),
      paramsFor(game.gameId),
    );
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error).toBe("wrong-piece-count");
  });

  it("rejects setup once the game is playing", async () => {
    const game = await createApiGame();
    const state = await driveToPlaying(game);
    const res = await POST(
      postRequest(
        setupUrl(game.gameId, game.southToken),
        validSetupBody(state, "south"),
      ),
      paramsFor(game.gameId),
    );
    expect(res.status).toBe(403);
    expect((await jsonOf(res)).error).toBe("wrong-phase");
  });

  it("returns 401 for a bad token and 404 for an unknown game", async () => {
    const game = await createApiGame();
    const state = await southState(game.gameId, game.southToken);
    const res = await POST(
      postRequest(
        setupUrl(game.gameId, "deadbeef"),
        validSetupBody(state, "south"),
      ),
      paramsFor(game.gameId),
    );
    expect(res.status).toBe(401);
    expect(
      (
        await POST(
          postRequest(setupUrl("nope", "tok"), validSetupBody(state, "south")),
          paramsFor("nope"),
        )
      ).status,
    ).toBe(404);
  });
});

describe("POST setup late submission", () => {
  it("loses to auto-placement once the clock has expired", async () => {
    const game = await createApiGame();
    const state = await southState(game.gameId, game.southToken);
    await POST(
      postRequest(
        setupUrl(game.gameId, game.southToken),
        validSetupBody(state, "south"),
      ),
      paramsFor(game.gameId),
    );
    await patchRecord(game.gameId, (record) => {
      record.setupEndsAt = new Date(Date.now() - 1000).toISOString();
    });
    const late = await POST(
      postRequest(
        setupUrl(game.gameId, game.northToken),
        validSetupBody(state, "north"),
      ),
      paramsFor(game.gameId),
    );
    expect(late.status).toBe(403);
    expect((await jsonOf(late)).error).toBe("wrong-phase");
    // North was auto-placed instead: the game is playing with 30 pieces.
    const stored = await getGameStore().load(game.gameId);
    expect(stored!.state.phase).toBe("playing");
    expect(stored!.state.pieces).toHaveLength(30);
  });
});
