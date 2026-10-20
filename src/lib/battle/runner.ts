// Headless battle runner: play a full CPU-vs-CPU game with no UI.
//
// This is the same engine the pages use — createGame, autoPlaceSetup,
// choose-from-sanitized-view, movePieceStep / applyNerf / endTurn —
// driven in a loop instead of on timers. Every action is logged to a
// BattleLog as it happens, so the returned log is a complete,
// replayable record of the game.
//
// Two ways to drive it:
// - `runBattleGame(...)` — the whole game at once (tournaments, instant mode).
// - `createBattle` / `battleStep` / `finalizeBattle` — one action per call,
//   for the battle page's watch mode. The page re-renders between steps.
//
// Determinism: board + setup come from `seed`; the strategies' own
// randomness (tiebreaks) comes from `strategyRngSeed`. Same inputs,
// same game, on any machine — which is what makes tournament results
// reproducible and logs replayable.

import { tileIndex } from "../game/board";
import {
  MAX_POINTS_PER_PIECE_PER_TURN,
  MOVEMENT_POINTS_PER_TURN,
  NERF_POOL_COST,
  NERF_TOKEN_CAP,
  PIECES_TO_WIN,
} from "../game/constants";
import { applyNerf } from "../game/nerf";
import { endTurn, getPiece, movePieceStep } from "../game/movement";
import { autoPlaceSetup, createGame } from "../game/setup";
import { createSeededRng } from "../game/rng";
import type { GameState, PlayerId } from "../game/types";
import { BattleLog, type GameEndReason, type MoveEvent } from "./log";
import { getStrategy, sanitizeForPlayer, type CpuStrategy } from "./strategies";

export interface BattleOptions {
  /** Safety cap so a pathological game can't loop forever. Default 400. */
  maxTurns?: number;
  /** Seed for the strategies' tiebreak randomness. Defaults to a hash of `seed`. */
  strategyRngSeed?: number;
  /** Logged in game_start. Defaults to `battle-${seed}`. */
  gameId?: string;
}

export interface BattleResult {
  finalState: GameState;
  log: BattleLog;
  /** endTurn calls. */
  turns: number;
  /** Steps + nerfs. */
  actions: number;
}

/** Mutable driver for incremental play. The page holds one per battle. */
export interface BattleDriver {
  state: GameState;
  log: BattleLog;
  strategies: Record<PlayerId, CpuStrategy>;
  rng: () => number;
  maxTurns: number;
  turns: number;
  actions: number;
  hitCap: boolean;
  finished: boolean;
}

const DEFAULT_MAX_TURNS = 400;

function endReason(state: GameState, hitCap: boolean): GameEndReason {
  if (hitCap || state.phase !== "finished") return "turn_cap";
  const winner = state.winner!;
  return state.scores[winner] >= PIECES_TO_WIN ? "five_across" : "attrition";
}

/**
 * Set up a battle and log game_start + both setups. The returned driver
 * is mid-game and ready for battleStep calls.
 */
export function createBattle(
  seed: number,
  southStrategyId: string,
  northStrategyId: string,
  opts: BattleOptions = {},
): BattleDriver {
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const strategyRngSeed = opts.strategyRngSeed ?? ((seed * 7919 + 13) >>> 0);
  const gameId = opts.gameId ?? `battle-${seed}`;
  const strategies: Record<PlayerId, CpuStrategy> = {
    south: getStrategy(southStrategyId),
    north: getStrategy(northStrategyId),
  };

  const log = new BattleLog();
  const rng = createSeededRng(strategyRngSeed);

  let state = createGame(seed);
  const southSetup = autoPlaceSetup(state, "south");
  if (!southSetup.ok) throw new Error(`south auto-setup failed: ${southSetup.error}`);
  const northSetup = autoPlaceSetup(southSetup.state, "north");
  if (!northSetup.ok) throw new Error(`north auto-setup failed: ${northSetup.error}`);
  state = northSetup.state;

  log.push({
    v: 1,
    type: "game_start",
    gameId,
    seed,
    ts: new Date().toISOString(),
    strategies: { south: strategies.south.version, north: strategies.north.version },
    strategyRngSeed,
    tunables: {
      movementPointsPerTurn: MOVEMENT_POINTS_PER_TURN,
      maxPointsPerPiecePerTurn: MAX_POINTS_PER_PIECE_PER_TURN,
      piecesToWin: PIECES_TO_WIN,
      nerfTokenCap: NERF_TOKEN_CAP,
      nerfPoolCost: NERF_POOL_COST,
    },
  });
  for (const player of ["south", "north"] as PlayerId[]) {
    log.push({
      v: 1,
      type: "setup",
      player,
      pieces: state.pieces
        .filter((p) => p.owner === player)
        .map((p) => ({
          id: p.id,
          character: p.character,
          pos: [p.position.x, p.position.y] as [number, number],
        })),
      traps: state.traps
        .filter((t) => t.owner === player)
        .map((t) => [t.position.x, t.position.y] as [number, number]),
    });
  }

  return {
    state,
    log,
    strategies,
    rng,
    maxTurns,
    turns: 0,
    actions: 0,
    hitCap: false,
    finished: false,
  };
}

/** End the current player's turn inside the driver, logging turn_end. */
function driverEndTurn(driver: BattleDriver, player: PlayerId): void {
  const poolSpent = MOVEMENT_POINTS_PER_TURN - driver.state.movementPointsLeft;
  const done = endTurn(driver.state);
  if (!done.ok) {
    driver.finished = true;
    return;
  }
  driver.state = done.state;
  driver.turns++;
  driver.log.push({
    v: 1,
    type: "turn_end",
    turn: driver.turns,
    player,
    poolSpent,
    scores: { ...driver.state.scores },
  });
}

/**
 * Play exactly one action (a step, a nerf, or a turn-end when the strategy
 * has nothing). Returns short narration lines for the event feed, and
 * whether the battle is now over.
 */
export function battleStep(driver: BattleDriver): { narrations: string[]; done: boolean } {
  if (driver.finished) return { narrations: [], done: true };
  if (driver.turns >= driver.maxTurns) {
    driver.hitCap = true;
    driver.finished = true;
    return { narrations: ["Turn cap reached — calling it a draw."], done: true };
  }

  const player = driver.state.currentPlayer;
  const strategy = driver.strategies[player];
  const action = strategy.choose(sanitizeForPlayer(driver.state, player), player, driver.rng);
  const side = player === "south" ? "South" : "North";

  if (!action) {
    driverEndTurn(driver, player);
    return { narrations: [`${side} ends its turn.`], done: driver.finished };
  }

  if (action.kind === "nerf") {
    const target = getPiece(driver.state, action.targetPieceId);
    const result = applyNerf(driver.state, player, action.targetPieceId);
    if (!result.ok) {
      // A strategy only picks legal targets on its sanitized view, and
      // hidden traps don't affect nerf legality — unreachable in practice.
      // End the turn rather than corrupt the log.
      driverEndTurn(driver, player);
      return { narrations: [`${side} ends its turn.`], done: driver.finished };
    }
    driver.state = result.state;
    driver.actions++;
    driver.log.push({
      v: 1,
      type: "nerf",
      turn: driver.turns + 1,
      player,
      targetPieceId: action.targetPieceId,
      targetCharacter: target!.character,
      targetOwner: target!.owner,
      tokensLeft: driver.state.nerfTokens[player],
      attritionLoss: result.outcome.attritionLoss,
    });
    if (driver.state.phase === "finished") driver.finished = true;
    return {
      narrations: [
        `⚡ ${side} nerfs ${target!.owner === "south" ? "South" : "North"}'s ${target!.character} (${action.targetPieceId})${result.outcome.attritionLoss ? " — game over by attrition!" : ""}`,
      ],
      done: driver.finished,
    };
  }

  const piece = getPiece(driver.state, action.pieceId)!;
  const from = piece.position;
  const result = movePieceStep(driver.state, action.pieceId, action.to);
  if (!result.ok) {
    driverEndTurn(driver, player);
    return { narrations: [`${side} ends its turn.`], done: driver.finished };
  }
  driver.state = result.state;
  driver.actions++;
  const events: MoveEvent["events"] = [];
  if (result.outcome.eliminated) {
    events.push({ kind: "trap", pos: [action.to.x, action.to.y], pieceEliminated: true });
  } else if (result.outcome.scored) {
    events.push({ kind: "score", pieceId: action.pieceId, newScore: driver.state.scores[player] });
  }
  driver.log.push({
    v: 1,
    type: "move",
    turn: driver.turns + 1,
    player,
    pieceId: action.pieceId,
    character: piece.character,
    from: [from.x, from.y],
    to: [action.to.x, action.to.y],
    cost: result.outcome.cost,
    terrain: driver.state.tiles[tileIndex(action.to.x, action.to.y)].terrain,
    poolSpentOnPiece: driver.state.spentThisTurn[action.pieceId] ?? 0,
    poolLeft: driver.state.movementPointsLeft,
    events,
  });
  if (driver.state.phase === "finished") driver.finished = true;

  const label = `${side} ${piece.character}`;
  const narrations = result.outcome.eliminated
    ? [
        `💥 ${label} steps to (${action.to.x}, ${action.to.y}) and hits a trap!`,
        ...(driver.finished ? ["That's attrition — game over."] : []),
      ]
    : result.outcome.scored
      ? [
          `🎉 ${label} crosses! ${side}: ${driver.state.scores[player]}/${PIECES_TO_WIN}${driver.finished ? " — game over!" : ""}`,
        ]
      : [];
  return { narrations, done: driver.finished };
}

/** Log game_end and return the final result. Idempotent — safe to call once. */
export function finalizeBattle(driver: BattleDriver): BattleResult {
  const reason = endReason(driver.state, driver.hitCap);
  driver.log.push({
    v: 1,
    type: "game_end",
    winner: driver.state.winner,
    reason,
    turns: driver.turns,
    actions: driver.actions,
    scores: { ...driver.state.scores },
    eliminated: {
      north: driver.state.pieces.filter((p) => p.owner === "north" && p.status === "eliminated").length,
      south: driver.state.pieces.filter((p) => p.owner === "south" && p.status === "eliminated").length,
    },
  });
  return { finalState: driver.state, log: driver.log, turns: driver.turns, actions: driver.actions };
}

/** The whole game at once — what tournaments and instant mode use. */
export function runBattleGame(
  seed: number,
  southStrategyId: string,
  northStrategyId: string,
  opts: BattleOptions = {},
): BattleResult {
  const driver = createBattle(seed, southStrategyId, northStrategyId, opts);
  while (!driver.finished) {
    battleStep(driver);
  }
  return finalizeBattle(driver);
}
