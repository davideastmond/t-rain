// POST /api/games/[gameId]/end-turn — pass the turn to the other player.

import { endTurn, findDrownedPiece } from "@/lib/game/movement";
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

  if (record.state.phase !== "playing") {
    return Response.json({ error: "wrong-phase" }, { status: 403 });
  }
  if (seat !== record.state.currentPlayer) {
    return Response.json({ error: "not-your-turn" }, { status: 403 });
  }

  const result = endTurn(record.state);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 403 });
  }

  // A piece still on water drowns at endTurn — announced before the
  // handover. If the drowning ends the game, the turn never passes, so
  // game-finished replaces turn-ended.
  const newEvents: NewEvent[] = [];
  const drowned = findDrownedPiece(record.state, result.state);
  if (drowned) {
    newEvents.push({
      type: "piece-drowned",
      player: seat,
      pieceId: drowned.id,
    });
  }
  if (result.state.phase === "finished" && result.state.winner) {
    const winner: PlayerId = result.state.winner;
    newEvents.push({ type: "game-finished", winner, reason: "attrition" });
  } else {
    newEvents.push({ type: "turn-ended", player: seat });
  }

  let eventsLog: NetEvent[] = record.events;
  for (const event of newEvents) {
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
    events: eventsLog.slice(eventsLog.length - newEvents.length),
  });
}
