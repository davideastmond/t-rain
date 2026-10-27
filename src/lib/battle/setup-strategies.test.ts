// Setup strategy registry + createBattle wiring tests
// (HARD_CPU_PHASE2_SPEC.md §1.3).
import { describe, expect, it } from "vitest";

import { createBattle } from "./runner";
import { getSetupStrategy } from "./setup-strategies";
import type { GameStartEvent, SetupEvent } from "./log";

describe("getSetupStrategy", () => {
  it("registers auto and choke with versions", () => {
    expect(getSetupStrategy("auto").version).toBe("auto@v1");
    expect(getSetupStrategy("choke").version).toBe("choke@v1");
  });

  it("throws on an unknown id", () => {
    expect(() => getSetupStrategy("nope")).toThrow("Unknown setup strategy");
  });
});

describe("createBattle setup wiring", () => {
  it("uses the requested setup per side and logs versions", () => {
    const driver = createBattle(42, "full", "full", { southSetupId: "choke" });
    expect(driver.state.phase).toBe("playing");
    expect(driver.state.traps.filter((t) => t.owner === "south")).toHaveLength(10);
    expect(driver.state.traps.filter((t) => t.owner === "north")).toHaveLength(10);
    const start = driver.log.all.find(
      (e) => e.type === "game_start",
    ) as GameStartEvent;
    expect(start.setups).toEqual({ south: "choke@v1", north: "auto@v1" });
    const setups = driver.log.all.filter((e) => e.type === "setup") as SetupEvent[];
    expect(setups).toHaveLength(2);
    expect(setups.find((s) => s.player === "south")!.traps).toHaveLength(10);
  });

  it("defaults to auto on both sides", () => {
    const driver = createBattle(42, "full", "full");
    const start = driver.log.all.find(
      (e) => e.type === "game_start",
    ) as GameStartEvent;
    expect(start.setups).toEqual({ south: "auto@v1", north: "auto@v1" });
  });

  it("is deterministic for the same seed and setup ids", () => {
    const a = createBattle(42, "full", "full", { southSetupId: "choke" });
    const b = createBattle(42, "full", "full", { southSetupId: "choke" });
    const trapsOf = (d: typeof a) =>
      d.state.traps
        .filter((t) => t.owner === "south")
        .map((t) => `${t.position.x},${t.position.y}`);
    expect(trapsOf(a)).toEqual(trapsOf(b));
  });
});
