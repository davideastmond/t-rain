import { describe, expect, it } from "vitest";

import { legalStepTargets } from "@/lib/game/movement";
import type { Piece } from "@/lib/game/types";
import {
  createApiGame,
  installRouteEnv,
  jsonOf,
  paramsFor,
  postRequest,
  validSetupBody,
} from "@/lib/net/route-test-helpers";
import { GET as stateGet } from "@/app/api/games/[gameId]/state/route";
import { POST as setupPost } from "@/app/api/games/[gameId]/setup/route";
import { POST as stepPost } from "@/app/api/games/[gameId]/step/route";
import { POST as endTurnPost } from "@/app/api/games/[gameId]/end-turn/route";
import { POST as forfeitPost } from "@/app/api/games/[gameId]/forfeit/route";

// Phase 2b (TEST_PLAN.md): one happy-path game played end to end
// through the routes — create → setups → playing → step → end turn →
// step → forfeit — with the version climbing at every mutation.

installRouteEnv();

describe("happy-path game through the routes", () => {
  it("plays from creation to forfeit with a climbing version", async () => {
    const game = await createApiGame();

    const stateRes = await stateGet(
      new Request(
        `http://test/api/games/${game.gameId}/state?t=${game.southToken}`,
      ),
      paramsFor(game.gameId),
    );
    const { state } = await jsonOf(stateRes);
    expect(state.phase).toBe("setup");

    let version = 1;
    for (const [token, seat] of [
      [game.southToken, "south"],
      [game.northToken, "north"],
    ] as const) {
      const res = await setupPost(
        postRequest(
          `http://test/api/games/${game.gameId}/setup?t=${token}`,
          validSetupBody(state, seat),
        ),
        paramsFor(game.gameId),
      );
      expect(res.status).toBe(200);
      version = (await jsonOf(res)).version;
    }
    expect(version).toBe(3);

    const playingRes = await stateGet(
      new Request(
        `http://test/api/games/${game.gameId}/state?t=${game.southToken}`,
      ),
      paramsFor(game.gameId),
    );
    const playing = (await jsonOf(playingRes)).state;
    expect(playing.phase).toBe("playing");
    const seat = playing.currentPlayer as "south" | "north";
    const token = seat === "south" ? game.southToken : game.northToken;

    const piece = playing.pieces.find(
      (p: Piece) => p.owner === seat && p.status === "active",
    );
    const to = legalStepTargets(playing, piece.id)[0];
    const stepRes = await stepPost(
      postRequest(`http://test/api/games/${game.gameId}/step?t=${token}`, {
        pieceId: piece.id,
        to,
      }),
      paramsFor(game.gameId),
    );
    expect(stepRes.status).toBe(200);
    expect((await jsonOf(stepRes)).version).toBe(4);

    const endRes = await endTurnPost(
      postRequest(`http://test/api/games/${game.gameId}/end-turn?t=${token}`),
      paramsFor(game.gameId),
    );
    const endBody = await jsonOf(endRes);
    expect(endRes.status).toBe(200);
    expect(endBody.version).toBe(5);
    expect(endBody.state.currentPlayer).toBe(
      seat === "south" ? "north" : "south",
    );

    const other = endBody.state.currentPlayer as "south" | "north";
    const otherToken =
      other === "south" ? game.southToken : game.northToken;
    const forfeitRes = await forfeitPost(
      postRequest(
        `http://test/api/games/${game.gameId}/forfeit?t=${otherToken}`,
      ),
      paramsFor(game.gameId),
    );
    const forfeitBody = await jsonOf(forfeitRes);
    expect(forfeitRes.status).toBe(200);
    expect(forfeitBody.version).toBe(6);
    expect(forfeitBody.state.phase).toBe("finished");
    expect(forfeitBody.state.winner).toBe(seat);
  });
});
