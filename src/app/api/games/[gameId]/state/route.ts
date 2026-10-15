// GET /api/games/[gameId]/state — versioned poll for one seat.
//
// Query: t=[token] (required), version=[N] (default 0), lastEventSeq=[M] (default 0).
//
// - Unknown game → 404. Missing/bad token → 401.
// - If the client's version matches the server's: a light
//   `{ changed: false }` — the game hasn't moved since they last asked.
// - Otherwise: `{ changed: true, version, state, events }`, where `state`
//   is the per-seat filtered view (the opponent's untriggered traps never
//   leave the server) and `events` are the log entries after lastEventSeq.
// - Both shapes carry `opponentSeenAgoSec` (presence; null if the
//   opponent's link was never opened).
// - Side effect: north's first authenticated request is the lobby → setup
//   join — it starts the setup clock and bumps the version.

import { SETUP_TIME_SECONDS } from "@/lib/game/constants";
import { sanitizeForPlayer } from "@/lib/game/cpu";
import type { PlayerId } from "@/lib/game/types";
import { authenticateGameRequest } from "@/lib/net/auth";
import { appendEvent, getGameStore } from "@/lib/net/games";
import type { GameRecord } from "@/lib/net/store";

function seenAgoSec(seenAt: string | null): number | null {
  if (seenAt === null) return null;
  return Math.max(0, Math.round((Date.now() - Date.parse(seenAt)) / 1000));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const { gameId } = await params;
  const query = new URL(request.url).searchParams;
  const token = query.get("t");
  const clientVersion = Number(query.get("version") ?? "0");
  const lastEventSeq = Number(query.get("lastEventSeq") ?? "0");

  const auth = await authenticateGameRequest(gameId, token);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  const store = getGameStore();
  let { record } = auth.ctx;
  const { seat } = auth.ctx;

  // Lobby → setup: north's first authenticated request starts the clock.
  if (
    seat === "north" &&
    record.seats.north.lastSeenAt === null &&
    record.state.phase === "setup"
  ) {
    const now = new Date().toISOString();
    const joined: GameRecord = {
      ...record,
      seats: {
        ...record.seats,
        north: { ...record.seats.north, lastSeenAt: now },
      },
      setupEndsAt: new Date(
        Date.now() + SETUP_TIME_SECONDS * 1000,
      ).toISOString(),
      events: appendEvent(record, { type: "player-joined", player: "north" }),
    };
    // CAS: a concurrent join attempt loses here and just re-reads.
    if (await store.save(joined, record.version)) {
      record = { ...joined, version: record.version + 1 };
    } else {
      const fresh = await store.load(gameId);
      if (fresh) record = fresh;
    }
  }

  const opponent: PlayerId = seat === "south" ? "north" : "south";
  const base = {
    version: record.version,
    opponentSeenAgoSec: seenAgoSec(record.seats[opponent].lastSeenAt),
  };

  if (Number.isFinite(clientVersion) && clientVersion === record.version) {
    return Response.json({ changed: false, ...base });
  }

  const since = Number.isFinite(lastEventSeq) ? lastEventSeq : 0;
  return Response.json({
    changed: true,
    ...base,
    state: sanitizeForPlayer(record.state, seat),
    events: record.events.filter((event) => event.seq > since),
  });
}
