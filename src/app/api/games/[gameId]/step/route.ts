// POST /api/games/[gameId]/step — move one piece one tile.
//
// Body: { pieceId, to: { x, y } }. One POST per tile entered, exactly like
// the local game: the server validates cost, per-piece cap, occupancy and
// water, resolves the trap check, and returns the outcome — so a trap
// revealed mid-turn is visible in the returned state and the client can
// replan the rest of the turn. No move rule is ever trusted to the client.

import { PIECES_TO_WIN } from "@/lib/game/constants";
import { movePieceStep } from "@/lib/game/movement";
import type { PlayerId, Position } from "@/lib/game/types";
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
  const query = new URL(request.url).searchParams;
  const token = query.get("t");

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

  if (record.state.phase !== "playing") {
    return Response.json({ error: "wrong-phase" }, { status: 403 });
  }
  if (seat !== record.state.currentPlayer) {
    return Response.json({ error: "not-your-turn" }, { status: 403 });
  }

  const body = await readBody(request);
  const pieceId =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).pieceId
      : undefined;
  const rawTo =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).to
      : undefined;
  const to: Position | null =
    typeof rawTo === "object" &&
    rawTo !== null &&
    Number.isInteger((rawTo as Record<string, unknown>).x) &&
    Number.isInteger((rawTo as Record<string, unknown>).y)
      ? {
          x: (rawTo as Record<string, unknown>).x as number,
          y: (rawTo as Record<string, unknown>).y as number,
        }
      : null;
  if (typeof pieceId !== "string" || !to) {
    return Response.json({ error: "malformed-body" }, { status: 400 });
  }

  // For the step event; the engine re-validates everything below.
  const from = record.state.pieces.find((p) => p.id === pieceId)?.position;

  const result = movePieceStep(record.state, pieceId, to);
  if (!result.ok) {
    return Response.json(
      { error: result.error },
      { status: errorStatus(result.error) },
    );
  }

  const events: NewEvent[] = [
    {
      type: "step",
      pieceId,
      // ok === true guarantees the piece existed.
      from: from!,
      to,
      cost: result.outcome.cost,
    },
  ];
  if (result.outcome.eliminated) {
    events.push({ type: "trap-triggered", position: to, victimPieceId: pieceId });
  }
  if (result.outcome.scored) {
    events.push({
      type: "scored",
      pieceId,
      player: seat,
      scores: result.state.scores,
    });
  }
  if (result.state.phase === "finished" && result.state.winner) {
    const winner: PlayerId = result.state.winner;
    events.push({
      type: "game-finished",
      winner,
      reason:
        result.state.scores[winner] >= PIECES_TO_WIN ? "crossed" : "attrition",
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
