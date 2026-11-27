// Local win/loss ladder against the CPU tiers, kept in this browser
// only (localStorage) — no account, no server, no usernames. One record
// per difficulty tier; only finished CPU games count (hotseat never
// touches it, and quitting mid-game doesn't either). The page records a
// finished game once, guarded by the game's instance id, and reads the
// record back for the pre-game and game-over lines.
import type { CpuDifficulty } from "./game/difficulty";

export interface LadderRecord {
  wins: number;
  losses: number;
  /** Current win streak (0 after a loss). */
  streak: number;
  /** Best win streak so far. */
  bestStreak: number;
}

export type Ladder = Record<CpuDifficulty, LadderRecord>;

export const LADDER_STORAGE_KEY = "train-ladder";

export function emptyRecord(): LadderRecord {
  return { wins: 0, losses: 0, streak: 0, bestStreak: 0 };
}

export function emptyLadder(): Ladder {
  return { normal: emptyRecord(), hard: emptyRecord() };
}

/**
 * Shared empty ladder for the server snapshot: useSyncExternalStore
 * requires getServerSnapshot to return the same value on every call,
 * and emptyLadder() builds a fresh object each time — passing it bare
 * logs "The result of getServerSnapshot should be cached" in dev.
 * Never mutated (recordResult and saveLadder always build new ladders).
 */
export const EMPTY_LADDER: Ladder = emptyLadder();

/** Record one finished game. Pure: returns a new ladder, never mutates. */
export function recordResult(
  ladder: Ladder,
  difficulty: CpuDifficulty,
  won: boolean,
): Ladder {
  const prev = ladder[difficulty];
  const streak = won ? prev.streak + 1 : 0;
  return {
    ...ladder,
    [difficulty]: {
      wins: prev.wins + (won ? 1 : 0),
      losses: prev.losses + (won ? 0 : 1),
      streak,
      bestStreak: Math.max(prev.bestStreak, streak),
    },
  };
}

function isRecord(value: unknown): value is LadderRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    ["wins", "losses", "streak", "bestStreak"] as const
  ).every(
    (field) =>
      typeof record[field] === "number" &&
      Number.isFinite(record[field]) &&
      (record[field] as number) >= 0,
  );
}

/** Load from localStorage; missing, corrupt, or partial data falls back
    to empty records per tier, so an old or hand-edited value never
    breaks the page. */
export function loadLadder(): Ladder {
  if (typeof window === "undefined") return emptyLadder();
  try {
    const raw = window.localStorage.getItem(LADDER_STORAGE_KEY);
    if (!raw) return emptyLadder();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return emptyLadder();
    const ladder = emptyLadder();
    for (const tier of ["normal", "hard"] as const) {
      const record = (parsed as Record<string, unknown>)[tier];
      if (isRecord(record)) ladder[tier] = record;
    }
    return ladder;
  } catch {
    return emptyLadder();
  }
}

let ladderCache: Ladder | null = null;

type LadderListener = () => void;
const ladderListeners = new Set<LadderListener>();

/** Subscribe to ladder changes (same-tab writes don't fire the
    `storage` event, so `saveLadder` notifies directly). Pairs with
    `useSyncExternalStore` in the UI — the same pattern as the mute
    preference in sound.ts. */
export function subscribeLadder(listener: LadderListener): () => void {
  ladderListeners.add(listener);
  return () => {
    ladderListeners.delete(listener);
  };
}

/** Current ladder, cached so the snapshot is referentially stable
    between writes (useSyncExternalStore requires that). */
export function getLadderSnapshot(): Ladder {
  if (ladderCache === null) ladderCache = loadLadder();
  return ladderCache;
}

/** Persist the ladder and notify subscribers; a storage failure
    (private mode, full storage) just means this session's record
    doesn't survive — the game plays on. */
export function saveLadder(ladder: Ladder): void {
  ladderCache = ladder;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LADDER_STORAGE_KEY, JSON.stringify(ladder));
  } catch {
    // Nothing to do: the ladder is a nice-to-have, not game state.
  }
  for (const listener of ladderListeners) listener();
}
