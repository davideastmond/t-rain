import { describe, expect, it } from "vitest";

import { BattleLog, parseJSONL } from "./log";
import {
  battleStep,
  createBattle,
  finalizeBattle,
  runBattleGame,
} from "./runner";
import { getStrategy } from "./strategies";

// Phase 1e (TEST_PLAN.md): battle-lab smoke tests only. Win rates are
// lab measurements, not contracts, so nothing here asserts who wins —
// only that games terminate, behave deterministically, and log
// round-trip cleanly.

describe("runBattleGame", () => {
  it("terminates within the turn cap with a well-formed result", () => {
    // Capped: a full default game is lab territory (the tournament
    // runs those), and the unit contract is termination + shape.
    // Battle turns are expensive (Dijkstra per piece per action), so
    // the cap stays small and the timeout generous.
    const result = runBattleGame(42, "pathfinder", "pathfinder", {
      maxTurns: 15,
    });
    expect(result.turns).toBeLessThanOrEqual(15);
    expect(result.actions).toBeGreaterThan(0);
    expect(result.log.length).toBeGreaterThanOrEqual(2);
    expect(result.log.all[0].type).toBe("game_start");
    expect(result.log.all[result.log.length - 1].type).toBe("game_end");
    // Winner set exactly when the game finished by the rules; a
    // winnerless result means the turn cap called it a draw.
    expect(result.finalState.winner !== null).toBe(
      result.finalState.phase === "finished",
    );
  }, 30000);

  it("is deterministic for a seed and strategy pair", () => {
    const opts = { maxTurns: 15 };
    const a = runBattleGame(7, "pathfinder", "pathfinder", opts);
    const b = runBattleGame(7, "pathfinder", "pathfinder", opts);
    expect(a.finalState.winner).toBe(b.finalState.winner);
    expect(a.turns).toBe(b.turns);
    expect(a.actions).toBe(b.actions);
    expect(a.finalState.scores).toEqual(b.finalState.scores);
  }, 30000);

  it("runs the full strategy without special-casing", () => {
    const result = runBattleGame(7, "full", "pathfinder", { maxTurns: 15 });
    expect(result.turns).toBeLessThanOrEqual(15);
    expect(result.log.length).toBeGreaterThanOrEqual(2);
  }, 30000);
});

describe("createBattle and battleStep", () => {
  it("steps incrementally until done", () => {
    const driver = createBattle(11, "pathfinder", "pathfinder", {
      maxTurns: 5,
    });
    expect(driver.state.phase).toBe("playing");
    let steps = 0;
    let done = false;
    while (!done && steps < 1000) {
      done = battleStep(driver).done;
      steps++;
    }
    expect(done).toBe(true);
    const result = finalizeBattle(driver);
    expect(result.turns).toBeLessThanOrEqual(5);
    expect(result.log.all[result.log.length - 1].type).toBe("game_end");
  });
});

describe("BattleLog and parseJSONL", () => {
  it("round-trips a finished game's log", () => {
    const result = runBattleGame(3, "pathfinder", "pathfinder", {
      maxTurns: 10,
    });
    const parsed = parseJSONL(result.log.toJSONL());
    expect(parsed).toHaveLength(result.log.length);
    expect(parsed[0].type).toBe("game_start");
    expect(parsed[parsed.length - 1].type).toBe("game_end");
  });

  it("throws on a malformed line instead of silently dropping it", () => {
    expect(() => parseJSONL('{"type":"game_start"}\nnot json\n')).toThrow();
  });

  it("tracks its own length", () => {
    const log = new BattleLog();
    expect(log.length).toBe(0);
  });
});

describe("getStrategy", () => {
  it("throws on an unknown strategy id", () => {
    expect(() => getStrategy("nope")).toThrow("Unknown CPU strategy");
  });
});
