// Authentication for the game API routes.
//
// A request is authenticated by gameId (path) + bearer token (query).
// The token is compared against the stored sha256 hash; the raw token
// never touches the database. Every authenticated request refreshes the
// seat's presence timestamp (without bumping the game version — see
// GameStore.touchSeat).

import type { PlayerId } from "@/lib/game/types";

import { hashToken, getGameStore } from "./games";
import type { GameRecord } from "./store";

export interface AuthedContext {
  record: GameRecord;
  seat: PlayerId;
}

export type AuthResult =
  | { ok: true; ctx: AuthedContext }
  | { ok: false; status: 404 | 401; error: string };

export async function authenticateGameRequest(
  gameId: string,
  token: string | null,
): Promise<AuthResult> {
  const store = getGameStore();
  const record = await store.load(gameId);
  if (!record) return { ok: false, status: 404, error: "game-not-found" };
  if (!token) return { ok: false, status: 401, error: "missing-token" };

  const hash = hashToken(token);
  const seat = (Object.keys(record.seats) as PlayerId[]).find(
    (s) => record.seats[s].tokenHash === hash,
  );
  if (!seat) return { ok: false, status: 401, error: "invalid-token" };

  await store.touchSeat(gameId, seat);
  return { ok: true, ctx: { record, seat } };
}
