// Battle logging: every CPU-vs-CPU game, as JSONL.
//
// One event per line, one line per event. The log is the contract between
// "run a battle now" and "tweak the algo later": seed + setup + the ordered
// event stream reconstructs the entire game exactly (the engine is
// deterministic), so a future tuner — human or script — can replay any game,
// recompute any derived stat, and compare strategy versions apples to
// apples without trusting today's analysis.
//
// The schema is versioned (`v: 1` on every event). If the schema ever
// changes, bump the version and keep the old readers working; never
// silently change what a field means.
//
// Nothing here is derived from a strategy's internals — only public engine
// inputs and outcomes. A strategy's evals, if it has any, stay private.

import type {
  CharacterId,
  MysteryBoxOutcome,
  PlayerId,
  TerrainType,
} from "../game/types";

/** [x, y] — compact and unambiguous. */
export type Coord = [number, number];

/** Which code played each side, e.g. "greedy@v1". */
export interface StrategyVersions {
  south: string;
  north: string;
}

export type GameEndReason = "five_across" | "attrition" | "turn_cap";

export interface GameStartEvent {
  v: 1;
  type: "game_start";
  gameId: string;
  seed: number;
  /** ISO timestamp of when the game started. */
  ts: string;
  strategies: StrategyVersions;
  /** RNG seed for the strategies' own randomness (tiebreaks etc.). */
  strategyRngSeed: number;
  /** Snapshot of the tunables, so a later constants change can't silently reinterpret old logs. */
  tunables: {
    movementPointsPerTurn: number;
    maxPointsPerPiecePerTurn: number;
    piecesToWin: number;
    nerfTokenCap: number;
    nerfPoolCost: number;
    boxExtraStepsChance: number;
    boxBridgeChance: number;
    extraStepsPoints: number;
    waterCrossCost: number;
  };
}

export interface SetupEvent {
  v: 1;
  type: "setup";
  player: PlayerId;
  pieces: Array<{ id: string; character: CharacterId; pos: Coord }>;
  traps: Coord[];
}

export interface MoveEvent {
  v: 1;
  type: "move";
  turn: number;
  player: PlayerId;
  pieceId: string;
  character: CharacterId;
  from: Coord;
  to: Coord;
  cost: number;
  terrain: TerrainType;
  /** Points spent on this piece so far this turn, after this step. */
  poolSpentOnPiece: number;
  /** Points left in the shared pool after this step. */
  poolLeft: number;
  /** Everything the step caused, in resolution order. */
  events: Array<
    | { kind: "trap"; pos: Coord; pieceEliminated: true }
    | { kind: "box"; outcome: MysteryBoxOutcome }
    | { kind: "score"; pieceId: string; newScore: number }
  >;
}

export interface NerfEvent {
  v: 1;
  type: "nerf";
  turn: number;
  player: PlayerId;
  targetPieceId: string;
  targetCharacter: CharacterId;
  targetOwner: PlayerId;
  tokensLeft: number;
  attritionLoss: boolean;
}

export interface TurnEndEvent {
  v: 1;
  type: "turn_end";
  turn: number;
  player: PlayerId;
  poolSpent: number;
  scores: Record<PlayerId, number>;
  /** Set when a piece drowned at this endTurn (ended its turn on water). */
  drownedPieceId?: string;
}

export interface GameEndEvent {
  v: 1;
  type: "game_end";
  winner: PlayerId | null;
  reason: GameEndReason;
  turns: number;
  /** Steps + nerfs. */
  actions: number;
  scores: Record<PlayerId, number>;
  eliminated: Record<PlayerId, number>;
}

export type BattleEvent =
  | GameStartEvent
  | SetupEvent
  | MoveEvent
  | NerfEvent
  | TurnEndEvent
  | GameEndEvent;

/**
 * Collects battle events in memory. The caller owns the sink: the battle
 * page downloads `toJSONL()`, a tournament concatenates several games,
 * a Node harness writes it to disk. The log never touches the network
 * or the filesystem itself.
 */
export class BattleLog {
  private events: BattleEvent[] = [];

  push(event: BattleEvent): void {
    this.events.push(event);
  }

  get length(): number {
    return this.events.length;
  }

  get all(): readonly BattleEvent[] {
    return this.events;
  }

  /** The whole log as JSONL: one JSON object per line. */
  toJSONL(): string {
    return this.events.map((e) => JSON.stringify(e)).join("\n");
  }
}

/** Parse JSONL back into events. Throws on a malformed line — a corrupt log should fail loudly, not silently. */
export function parseJSONL(jsonl: string): BattleEvent[] {
  return jsonl
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as BattleEvent);
}
