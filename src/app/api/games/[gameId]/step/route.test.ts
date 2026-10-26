import { describe, expect, it } from "vitest";

import type { Piece } from "@/lib/game/types";

import { legalStepTargets } from "@/lib/game/movement";
import {
  createApiGame,
  driveToPlaying,
  installRouteEnv,
  jsonOf,
  paramsFor,
  postRequest,
} from "@/lib/net/route-test-helpers";
import { getGameStore } from "@/lib/net/games";

import { POST } from "./route";

// Phase 2b (TEST_PLAN.md): POST /api/games/[gameId]/step by direct import.

installRouteEnv();

function stepUrl(gameId: string, token: string): string {
  return `http://test/api/games/${gameId}/step?t=${token}`;
}

describe("POST step happy path", () => {
  it("moves a piece, charges the pool, and logs the step", async () => {
    const game = await createApiGame();
    const state = await driveToPlaying(game);
    const seat = state.currentPlayer as "south" | "north";
    const token = seat === "south" ? game.southToken : game.northToken;
    const piece = state.pieces.find(
      (p: Piece) => p.owner === seat && p.status === "active",
    );
    const targets = legalStepTargets(state, piece.id);
    expect(targets.length).toBeGreaterThan(0);
    const to = targets[0];
    const res = await POST(
      postRequest(stepUrl(game.gameId, token), { pieceId: piece.id, to }),
      paramsFor(game.gameId),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.ok).toBe(true);
    expect(body.events[0].type).toBe("step");
    expect(body.events[0].pieceId).toBe(piece.id);
    expect(body.outcome.cost).toBeGreaterThan(0);
    expect(body.state.movementPointsLeft).toBe(10 - body.outcome.cost);
    // The stored state agrees with the response.
    const stored = await getGameStore().load(game.gameId);
    expect(stored!.version).toBe(body.version);
  });

  it("rejects a step from the wrong seat and in the wrong phase", async () => {
    const game = await createApiGame();
    const state = await driveToPlaying(game);
    const seat = state.currentPlayer as "south" | "north";
    const other = seat === "south" ? "north" : "south";
    const otherToken =
      other === "south" ? game.southToken : game.northToken;
    const piece = state.pieces.find(
      (p: Piece) => p.owner === seat && p.status === "active",
    );
    const to = legalStepTargets(state, piece.id)[0];
    const wrongTurn = await POST(
      postRequest(stepUrl(game.gameId, otherToken), {
        pieceId: piece.id,
        to,
      }),
      paramsFor(game.gameId),
    );
    expect(wrongTurn.status).toBe(403);
    expect((await jsonOf(wrongTurn)).error).toBe("not-your-turn");

    const fresh = await createApiGame();
    const wrongPhase = await POST(
      postRequest(stepUrl(fresh.gameId, fresh.southToken), {
        pieceId: "south-cat",
        to: { x: 0, y: 0 },
      }),
      paramsFor(fresh.gameId),
    );
    expect(wrongPhase.status).toBe(403);
    expect((await jsonOf(wrongPhase)).error).toBe("wrong-phase");
  });
});

describe("POST step validation", () => {
  it("rejects malformed bodies, unknown pieces, and illegal moves", async () => {
    const game = await createApiGame();
    const state = await driveToPlaying(game);
    const seat = state.currentPlayer as "south" | "north";
    const token = seat === "south" ? game.southToken : game.northToken;
    const malformed = await POST(
      postRequest(stepUrl(game.gameId, token), {}),
      paramsFor(game.gameId),
    );
    expect(malformed.status).toBe(400);
    expect((await jsonOf(malformed)).error).toBe("malformed-body");

    const unknown = await POST(
      postRequest(stepUrl(game.gameId, token), {
        pieceId: "south-nope",
        to: { x: 0, y: 0 },
      }),
      paramsFor(game.gameId),
    );
    expect(unknown.status).toBe(400);
    expect((await jsonOf(unknown)).error).toBe("piece-not-found");

    const piece = state.pieces.find(
      (p: Piece) => p.owner === seat && p.status === "active",
    );
    const far = { x: (piece.position.x + 2) % 30, y: piece.position.y };
    const illegal = await POST(
      postRequest(stepUrl(game.gameId, token), { pieceId: piece.id, to: far }),
      paramsFor(game.gameId),
    );
    expect(illegal.status).toBe(400);
    expect((await jsonOf(illegal)).error).toBe("not-adjacent");
  });

  it("lets exactly one of two concurrent steps win (CAS)", async () => {
    const game = await createApiGame();
    const state = await driveToPlaying(game);
    const seat = state.currentPlayer as "south" | "north";
    const token = seat === "south" ? game.southToken : game.northToken;
    const pieces: Piece[] = state.pieces.filter(
      (p: Piece) => p.owner === seat && p.status === "active",
    );
    const moves = pieces
      .map((p) => ({ p, targets: legalStepTargets(state, p.id) }))
      .filter((m) => m.targets.length > 0)
      .slice(0, 2);
    expect(moves.length).toBe(2);
    const [a, b] = await Promise.all([
      POST(
        postRequest(stepUrl(game.gameId, token), {
          pieceId: moves[0].p.id,
          to: moves[0].targets[0],
        }),
        paramsFor(game.gameId),
      ),
      POST(
        postRequest(stepUrl(game.gameId, token), {
          pieceId: moves[1].p.id,
          to: moves[1].targets[0],
        }),
        paramsFor(game.gameId),
      ),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect((await jsonOf(loser)).error).toBe("version-conflict");
  });
});
