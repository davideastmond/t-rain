import { afterAll, beforeAll } from "vitest";

import { NEUTRAL_ROW, TRAPS_PER_PLAYER } from "@/lib/game/constants";
import { ALL_CHARACTERS, isInPieceZone, isInTrapZone } from "@/lib/game/setup";
import type { GameState, PlayerId, Position } from "@/lib/game/types";

import { POST as createGamePost } from "@/app/api/games/route";
import { POST as setupPost } from "@/app/api/games/[gameId]/setup/route";
import { GET as stateGet } from "@/app/api/games/[gameId]/state/route";
import { getGameStore } from "./games";
import type { GameRecord } from "./store";

// Shared helpers for the route-handler tests (Phase 2b). Routes are
// called by direct import with plain Requests — no server, no mongo.
// BASE_URL is needed by POST /api/games (gameLink throws without it).

export function installRouteEnv(): void {
  let origBase: string | undefined;
  let origMongo: string | undefined;
  beforeAll(() => {
    origBase = process.env.BASE_URL;
    origMongo = process.env.MONGODB_URI;
    process.env.BASE_URL = "https://test.example";
    delete process.env.MONGODB_URI;
  });
  afterAll(() => {
    if (origBase === undefined) delete process.env.BASE_URL;
    else process.env.BASE_URL = origBase;
    if (origMongo !== undefined) process.env.MONGODB_URI = origMongo;
  });
}

export function postRequest(url: string, body?: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function paramsFor(gameId: string): {
  params: Promise<{ gameId: string }>;
} {
  return { params: Promise.resolve({ gameId }) };
}

export async function jsonOf(res: Response) {
  return res.json();
}

export interface ApiGame {
  gameId: string;
  southToken: string;
  northToken: string;
}

function tokenFromLink(link: string): string {
  return new URL(link).searchParams.get("t")!;
}

/** Create a game through POST /api/games; returns ids and both tokens. */
export async function createApiGame(): Promise<ApiGame> {
  const res = await createGamePost();
  if (res.status !== 201) {
    throw new Error(`createApiGame: expected 201, got ${res.status}`);
  }
  const body = await jsonOf(res);
  return {
    gameId: body.gameId,
    southToken: tokenFromLink(body.yourLink),
    northToken: tokenFromLink(body.inviteLink),
  };
}

/** A valid setup body built from the game's own tiles. */
export function validSetupBody(
  state: GameState,
  player: PlayerId,
): {
  pieces: Array<{ character: string; x: number; y: number }>;
  traps: Array<{ x: number; y: number }>;
} {
  const boxKeys = new Set(
    state.mysteryBoxes.map((b) => `${b.position.x},${b.position.y}`),
  );
  const piecePositions = state.tiles
    .filter((t) => isInPieceZone(player, t.position) && t.terrain !== "water")
    .slice(0, 15)
    .map((t) => t.position);
  const pieceKeys = new Set(piecePositions.map((p) => `${p.x},${p.y}`));
  const trapPositions: Position[] = [];
  let neutral = 0;
  for (const tile of state.tiles) {
    if (trapPositions.length >= TRAPS_PER_PLAYER) break;
    const { position } = tile;
    if (!isInTrapZone(player, position)) continue;
    if (tile.terrain === "water") continue;
    if (boxKeys.has(`${position.x},${position.y}`)) continue;
    if (pieceKeys.has(`${position.x},${position.y}`)) continue;
    if (position.y === NEUTRAL_ROW) {
      if (neutral >= 3) continue;
      neutral++;
    }
    trapPositions.push(position);
  }
  return {
    pieces: ALL_CHARACTERS.map((character, i) => ({
      character,
      x: piecePositions[i].x,
      y: piecePositions[i].y,
    })),
    traps: trapPositions.map((p) => ({ x: p.x, y: p.y })),
  };
}

/** Drive a fresh API game to the playing phase via both setup routes. */
export async function driveToPlaying(game: ApiGame) {
  const stateRes = await stateGet(
    new Request(
      `http://test/api/games/${game.gameId}/state?t=${game.southToken}`,
    ),
    paramsFor(game.gameId),
  );
  const { state } = await jsonOf(stateRes);
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
    if (res.status !== 200) {
      throw new Error(
        `driveToPlaying: ${seat} setup failed with ${res.status}`,
      );
    }
  }
  const finalRes = await stateGet(
    new Request(
      `http://test/api/games/${game.gameId}/state?t=${game.southToken}`,
    ),
    paramsFor(game.gameId),
  );
  const finalBody = await jsonOf(finalRes);
  if (finalBody.state.phase !== "playing") {
    throw new Error("driveToPlaying: game did not reach playing phase");
  }
  return finalBody.state;
}

/** Load a record, mutate it, and save it back (throws if the save loses). */
export async function patchRecord(
  gameId: string,
  patch: (record: GameRecord) => void,
): Promise<GameRecord> {
  const store = getGameStore();
  const record = (await store.load(gameId))!;
  patch(record);
  const saved = await store.save(record, record.version);
  if (!saved) throw new Error("route-test-helpers: patch save lost the race");
  return (await store.load(gameId))!;
}
