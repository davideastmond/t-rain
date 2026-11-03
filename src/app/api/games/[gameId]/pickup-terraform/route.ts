// POST /api/games/[gameId]/pickup-terraform — turn one water or forest
// tile into plains with a held terraform power (PICKUP_POWERS_SPEC.md).
//
// Body: { position: { x, y } }. Follows the nerf route: auth, expired
// setup clock first, then the engine validates everything (phase, turn,
// held power, pool, target). Unlike trap placement, this IS a public
// feed event: the tile itself changes on the shared board, so there is
// nothing to hide — both seats narrate it from the event.

import { applyTerraform } from "@/lib/game/pickups";
import type { Position } from "@/lib/game/types";
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

function isPosition(value: unknown): value is Position {
  if (typeof value !== "object" || value === null) return false;
  const { x, y } = value as Record<string, unknown>;
  return Number.isInteger(x) && Number.isInteger(y);
}

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
  const rawPosition =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).position
      : undefined;
  if (!isPosition(rawPosition)) {
    return Response.json({ error: "malformed-body" }, { status: 400 });
  }
  const position: Position = {
    x: (rawPosition as Position).x,
    y: (rawPosition as Position).y,
  };

  const result = applyTerraform(record.state, seat, position);
  if (!result.ok) {
    return Response.json(
      { error: result.error },
      { status: errorStatus(result.error) },
    );
  }

  const events: NewEvent[] = [{ type: "terraformed", player: seat, position }];
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
    outcome: { kind: "terraform", position },
    events: eventsLog.slice(eventsLog.length - events.length),
  });
}
