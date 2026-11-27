// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  EMPTY_LADDER,
  emptyLadder,
  emptyRecord,
  getLadderSnapshot,
  LADDER_STORAGE_KEY,
  loadLadder,
  recordResult,
  saveLadder,
  subscribeLadder,
  type Ladder,
} from "./ladder";

describe("recordResult", () => {
  it("counts a win and grows the streak", () => {
    const next = recordResult(emptyLadder(), "hard", true);
    expect(next.hard).toEqual({
      wins: 1,
      losses: 0,
      streak: 1,
      bestStreak: 1,
    });
    expect(next.normal).toEqual(emptyRecord());
  });

  it("counts a loss, resets the streak, and keeps the best streak", () => {
    const ladder: Ladder = {
      normal: emptyRecord(),
      hard: { wins: 3, losses: 1, streak: 3, bestStreak: 3 },
    };
    const next = recordResult(ladder, "hard", false);
    expect(next.hard).toEqual({
      wins: 3,
      losses: 2,
      streak: 0,
      bestStreak: 3,
    });
  });

  it("tracks each tier independently", () => {
    const won = recordResult(emptyLadder(), "normal", true);
    const thenLost = recordResult(won, "hard", false);
    expect(thenLost.normal).toEqual({
      wins: 1,
      losses: 0,
      streak: 1,
      bestStreak: 1,
    });
    expect(thenLost.hard).toEqual({
      wins: 0,
      losses: 1,
      streak: 0,
      bestStreak: 0,
    });
  });

  it("does not mutate the input ladder", () => {
    const ladder = emptyLadder();
    recordResult(ladder, "normal", true);
    expect(ladder).toEqual(emptyLadder());
  });
});

describe("loadLadder / saveLadder", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("loads an empty ladder when nothing is stored", () => {
    expect(loadLadder()).toEqual(emptyLadder());
  });

  it("round-trips a recorded ladder", () => {
    const ladder = recordResult(
      recordResult(emptyLadder(), "hard", true),
      "hard",
      true,
    );
    saveLadder(ladder);
    expect(loadLadder()).toEqual(ladder);
  });

  it("falls back to empty records on corrupt JSON", () => {
    window.localStorage.setItem(LADDER_STORAGE_KEY, "not json{");
    expect(loadLadder()).toEqual(emptyLadder());
  });

  it("fills a missing tier with an empty record", () => {
    window.localStorage.setItem(
      LADDER_STORAGE_KEY,
      JSON.stringify({
        normal: { wins: 2, losses: 1, streak: 0, bestStreak: 2 },
      }),
    );
    expect(loadLadder()).toEqual({
      normal: { wins: 2, losses: 1, streak: 0, bestStreak: 2 },
      hard: emptyRecord(),
    });
  });

  it("ignores a malformed tier and keeps the good one", () => {
    window.localStorage.setItem(
      LADDER_STORAGE_KEY,
      JSON.stringify({
        normal: { wins: 2, losses: 1, streak: 0, bestStreak: 2 },
        hard: { wins: "three", losses: 0, streak: 0, bestStreak: 0 },
      }),
    );
    expect(loadLadder()).toEqual({
      normal: { wins: 2, losses: 1, streak: 0, bestStreak: 2 },
      hard: emptyRecord(),
    });
  });
});

describe("EMPTY_LADDER", () => {
  it("is an empty ladder, shared by reference for the server snapshot", () => {
    // useSyncExternalStore requires getServerSnapshot to return the
    // same reference on every call — a fresh emptyLadder() each time
    // logs "The result of getServerSnapshot should be cached" in dev.
    expect(EMPTY_LADDER).toEqual(emptyLadder());
    expect(EMPTY_LADDER).toBe(EMPTY_LADDER);
  });
});

describe("subscribeLadder / getLadderSnapshot", () => {
  it("returns the saved ladder and notifies subscribers on save", () => {
    const seen: Ladder[] = [];
    const unsubscribe = subscribeLadder(() => {
      seen.push(getLadderSnapshot());
    });
    const ladder = recordResult(emptyLadder(), "normal", true);
    saveLadder(ladder);
    expect(getLadderSnapshot()).toEqual(ladder);
    expect(seen).toEqual([ladder]);
    unsubscribe();
    saveLadder(emptyLadder());
    expect(seen).toEqual([ladder]);
  });
});
