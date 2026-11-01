import { describe, expect, it } from "vitest";
import type { NetEvent } from "@/lib/net/store";

import { setTerrain } from "@/lib/game/test-helpers";
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
import { POST as stepPost } from "../step/route";
import { POST } from "./route";

// Phase 3 (PICKUP_POWERS_SPEC.md): POST /api/games/[gameId]/pickup-terraform
// by direct import, plus the collection invisibility contract — a step
// onto a pickup narrates to the collector from the response only, never
// through the shared feed.

installRouteEnv();

function terraformUrl(gameId: string, token: string): string {
  return `http://test/api/games/${gameId}/pickup-terraform?t=${token}`;
}

/** A playing game where south holds a terraform power, pool full, south to move. */
async function terraformReadyGame() {
  const game = await createApiGame();
  await driveToPlaying(game);
  await patchRecord(game.gameId, (record) => {
    record.state.currentPlayer = "south";
    record.state.movementPointsLeft = 10;
    record.state.spentThisTurn = {};
    record.state.heldPowers = { north: [], south: ["terraform"] };
  });
  return game;
}

describe("POST pickup-terraform happy path", () => {
  it("turns the tile into plains, spends the power and pool, and logs it", async () => {
    const game = await terraformReadyGame();
    const target = { x: 10, y: 12 };
    await patchRecord(game.gameId, (record) => {
      record.state = setTerrain(record.state, target.x, target.y, "water");
    });
    const res = await POST(
      postRequest(terraformUrl(game.gameId, game.southToken), {
        position: target,
      }),
      paramsFor(game.gameId),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.ok).toBe(true);
    expect(body.outcome).toEqual({ kind: "terraform", position: target });
    expect(body.events.map((e: NetEvent) => e.type)).toEqual(["terraformed"]);
    expect(body.state.tiles[target.y * 30 + target.x].terrain).toBe("plains");
    expect(body.state.heldPowers.south).toEqual([]);
    expect(body.state.movementPointsLeft).toBe(7);
  });
});

describe("POST pickup-terraform validation", () => {
  it("rejects a malformed body, a plains target, and no held power", async () => {
    const game = await terraformReadyGame();
    const malformed = await POST(
      postRequest(terraformUrl(game.gameId, game.southToken), {}),
      paramsFor(game.gameId),
    );
    expect(malformed.status).toBe(400);
    expect((await jsonOf(malformed)).error).toBe("malformed-body");

    const stored = (await getGameStore().load(game.gameId))!;
    const plains = stored.state.tiles.find((t) => t.terrain === "plains")!;
    const plainsRes = await POST(
      postRequest(terraformUrl(game.gameId, game.southToken), {
        position: plains.position,
      }),
      paramsFor(game.gameId),
    );
    expect(plainsRes.status).toBe(400);
    expect((await jsonOf(plainsRes)).error).toBe("invalid-target");

    await patchRecord(game.gameId, (record) => {
      record.state.heldPowers = { north: [], south: [] };
    });
    const noPower = await POST(
      postRequest(terraformUrl(game.gameId, game.southToken), {
        position: { x: 10, y: 12 },
      }),
      paramsFor(game.gameId),
    );
    expect(noPower.status).toBe(400);
    expect((await jsonOf(noPower)).error).toBe("no-power");
  });
});

describe("pickup collection stays invisible", () => {
  it("collects from the step response only — no feed event, opponent blind", async () => {
    const game = await createApiGame();
    await driveToPlaying(game);
    // Park a south piece next to a pinned-plains pickup tile.
    await patchRecord(game.gameId, (record) => {
      const piece = record.state.pieces.find(
        (p) => p.owner === "south" && p.status === "active",
      )!;
      const target = { x: piece.position.x, y: piece.position.y - 1 };
      let state = setTerrain(record.state, target.x, target.y, "plains");
      state = {
        ...state,
        traps: state.traps.filter(
          (t) => !(t.position.x === target.x && t.position.y === target.y),
        ),
        mysteryBoxes: state.mysteryBoxes.filter(
          (b) => !(b.position.x === target.x && b.position.y === target.y),
        ),
        pickups: [{ position: target, kind: "terraform" }],
        currentPlayer: "south",
        movementPointsLeft: 10,
        spentThisTurn: {},
      };
      record.state = state;
    });
    const stored = (await getGameStore().load(game.gameId))!;
    const piece = stored.state.pieces.find(
      (p) => p.owner === "south" && p.status === "active",
    )!;
    // Re-derive the target from the parked pickup (the piece sits just
    // below it by construction).
    const target = stored.state.pickups[0].position;
    const res = await stepPost(
      postRequest(
        `http://test/api/games/${game.gameId}/step?t=${game.southToken}`,
        { pieceId: piece.id, to: target },
      ),
      paramsFor(game.gameId),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.outcome.pickup).toBe("terraform");
    expect(body.events.map((e: NetEvent) => e.type)).toEqual(["step"]);
    expect(body.state.heldPowers.south).toEqual(["terraform"]);
    // The opponent's polled view shows nothing: no pickups, and south's
    // held powers redacted away.
    const northView = await stateGet(
      new Request(
        `http://test/api/games/${game.gameId}/state?t=${game.northToken}&version=0&lastEventSeq=0`,
      ),
      paramsFor(game.gameId),
    );
    const northBody = await jsonOf(northView);
    expect(northBody.state.pickups).toEqual([]);
    expect(northBody.state.heldPowers).toEqual({ north: [], south: [] });
  });
});
