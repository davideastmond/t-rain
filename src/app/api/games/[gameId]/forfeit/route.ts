// POST /api/games/[gameId]/forfeit — resign the game. The other seat wins.

import { otherPlayer } from "@/lib/game/setup";
import type { PlayerId } from "@/lib/game/types";
import { authenticateGameRequest } from "@/lib/net/auth";
import {
  appendEvent,
  getGameStore,
  maybeAutoPlaceSetup,
  sanitizeForNetPlayer,
  type NewEvent,
} from "@/lib/net/games";
import type { GameRecord, NetEvent } from "@/lib/net/store";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const { gameId } = await params;
  const token = new URL(request.url).searchParams.get("t");

  const auth = await authenticateGameRequest(gameId, token);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  const store = getGameStore();
  let { record } = auth.ctx;
  const { seat } = auth.ctx;

  const auto = maybeAutoPlaceSetup(record);
  if (auto.changed && (await store.save(auto.record, record.version))) {
    record = { ...auto.record, version: record.version + 1 };
  }

  if (record.state.phase === "finished") {
    return Response.json({ error: "wrong-phase" }, { status: 403 });
  }

  const winner: PlayerId = otherPlayer(seat);
  const events: NewEvent[] = [
    { type: "forfeited", player: seat },
    { type: "game-finished", winner, reason: "forfeit" },
  ];
  let eventsLog: NetEvent[] = record.events;
  for (const event of events) {
    eventsLog = appendEvent({ ...record, events: eventsLog }, event);
  }
  const updated: GameRecord = {
    ...record,
    state: { ...record.state, phase: "finished", winner },
    events: eventsLog,
  };
  if (!(await store.save(updated, record.version))) {
    return Response.json({ error: "version-conflict" }, { status: 409 });
  }
  return Response.json({
    ok: true,
    version: record.version + 1,
    state: sanitizeForNetPlayer(updated.state, seat),
    events: eventsLog.slice(eventsLog.length - events.length),
  });
}
