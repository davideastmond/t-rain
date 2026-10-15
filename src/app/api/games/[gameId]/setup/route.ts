// POST /api/games/[gameId]/setup — submit one seat's setup.
//
// Body: { pieces: [{ character, x, y } × 15], traps: [{ x, y } × 10] }.
// The whole submission is validated by the setup engine (zones, counts,
// neutral cap, water); invalid submissions are rejected wholesale and the
// client keeps its draft. One submission per seat. If the setup clock
// already expired, auto-placement runs first and a late submission loses.

import { CHARACTERS } from "@/lib/game/constants";
import { applySetup } from "@/lib/game/setup";
import { sanitizeForPlayer } from "@/lib/game/cpu";
import type { CharacterId, Position } from "@/lib/game/types";
import { authenticateGameRequest } from "@/lib/net/auth";
import { errorStatus } from "@/lib/net/errors";
import {
  appendEvent,
  getGameStore,
  maybeAutoPlaceSetup,
} from "@/lib/net/games";
import type { GameRecord } from "@/lib/net/store";

interface ParsedSetup {
  pieces: Array<{ character: CharacterId; position: Position }>;
  traps: Position[];
}

function isPosition(value: unknown): value is Position {
  if (typeof value !== "object" || value === null) return false;
  const { x, y } = value as Record<string, unknown>;
  return Number.isInteger(x) && Number.isInteger(y);
}

function parseSetupBody(body: unknown): ParsedSetup | null {
  if (typeof body !== "object" || body === null) return null;
  const { pieces, traps } = body as Record<string, unknown>;
  if (!Array.isArray(pieces) || !Array.isArray(traps)) return null;
  const parsedPieces: ParsedSetup["pieces"] = [];
  for (const entry of pieces) {
    if (typeof entry !== "object" || entry === null) return null;
    const { character, x, y } = entry as Record<string, unknown>;
    if (typeof character !== "string" || !(character in CHARACTERS)) return null;
    if (!isPosition({ x, y })) return null;
    parsedPieces.push({
      character: character as CharacterId,
      position: { x: x as number, y: y as number },
    });
  }
  const parsedTraps: Position[] = [];
  for (const entry of traps) {
    if (!isPosition(entry)) return null;
    parsedTraps.push({ x: (entry as Position).x, y: (entry as Position).y });
  }
  return { pieces: parsedPieces, traps: parsedTraps };
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

  // The clock may have expired while polling: auto-place first, so a late
  // manual submission is judged against the post-deadline state.
  const auto = maybeAutoPlaceSetup(record);
  if (auto.changed) {
    if (await store.save(auto.record, record.version)) {
      record = { ...auto.record, version: record.version + 1 };
    } else {
      const fresh = await store.load(gameId);
      if (fresh) record = fresh;
    }
  }

  if (record.setupEndsAt === null || record.state.phase !== "setup") {
    return Response.json({ error: "wrong-phase" }, { status: 403 });
  }

  const parsed = parseSetupBody(await readBody(request));
  if (!parsed) {
    return Response.json({ error: "malformed-body" }, { status: 400 });
  }

  const result = applySetup(record.state, seat, parsed.pieces, parsed.traps);
  if (!result.ok) {
    return Response.json(
      { error: result.error },
      { status: errorStatus(result.error) },
    );
  }

  const updated: GameRecord = {
    ...record,
    state: result.state,
    events: appendEvent(record, { type: "setup-submitted", player: seat }),
  };
  if (!(await store.save(updated, record.version))) {
    return Response.json({ error: "version-conflict" }, { status: 409 });
  }
  return Response.json({
    ok: true,
    version: record.version + 1,
    state: sanitizeForPlayer(result.state, seat),
  });
}
