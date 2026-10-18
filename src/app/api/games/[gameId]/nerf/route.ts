// POST /api/games/[gameId]/nerf — spend a nerf token to eliminate one
// active opponent piece adjacent to one of yours.

import { applyNerf } from "@/lib/game/nerf";
import { authenticateGameRequest } from "@/lib/net/auth";
import { errorStatus } from "@/lib/net/errors";
import {
  appendEvent,
  getGameStore,
  maybeAutoPlaceSetup,
  sanitizeForNetPlayer,
  type NewEvent,
} from "@/lib/net/games";
import type { GameRecord, NetEvent } from "@/lib/net/store";

async function readBody(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

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

  const body = await readBody(request);
  const targetPieceId =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).targetPieceId
      : undefined;
  if (typeof targetPieceId !== "string") {
    return Response.json({ error: "malformed-body" }, { status: 400 });
  }

  // The engine validates everything (phase, turn, token, pool, target);
  // errorStatus maps wrong-phase/not-your-turn to 403, the rest to 400.
  const result = applyNerf(record.state, seat, targetPieceId);
  if (!result.ok) {
    return Response.json(
      { error: result.error },
      { status: errorStatus(result.error) },
    );
  }

  const events: NewEvent[] = [{ type: "nerfed", player: seat, targetPieceId }];
  if (result.state.phase === "finished") {
    events.push({
      type: "game-finished",
      winner: result.state.winner!,
      reason: "attrition",
    });
  }
  let eventsLog: NetEvent[] = record.events;
  for (const event of events) {
    eventsLog = appendEvent({ ...record, events: eventsLog }, event);
  }
  const updated: GameRecord = {
    ...record,
    state: result.state,
    events: eventsLog,
  };
  if (!(await store.save(updated, record.version))) {
    return Response.json({ error: "version-conflict" }, { status: 409 });
  }
  return Response.json({
    ok: true,
    version: record.version + 1,
    state: sanitizeForNetPlayer(result.state, seat),
    outcome: result.outcome,
    events: eventsLog.slice(eventsLog.length - events.length),
  });
}
