// POST /api/games/[gameId]/end-turn — pass the turn to the other player.

import { endTurn } from "@/lib/game/movement";
import { authenticateGameRequest } from "@/lib/net/auth";
import {
  appendEvent,
  getGameStore,
  maybeAutoPlaceSetup,
  sanitizeForNetPlayer,
} from "@/lib/net/games";
import type { GameRecord } from "@/lib/net/store";

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

  const events = appendEvent(record, { type: "turn-ended", player: seat });
  const updated: GameRecord = { ...record, state: result.state, events };
  if (!(await store.save(updated, record.version))) {
    return Response.json({ error: "version-conflict" }, { status: 409 });
  }
  return Response.json({
    ok: true,
    version: record.version + 1,
    state: sanitizeForNetPlayer(result.state, seat),
    events: events.slice(events.length - 1),
  });
}
