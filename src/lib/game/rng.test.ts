import { describe, expect, it } from "vitest";

import { createSeededRng } from "./rng";

// Phase 0 smoke test (TEST_PLAN.md rollout step 1): proves the runner,
// the `@/`-free relative import, and the determinism the whole engine
// depends on — same seed, same sequence, on any machine.
describe("createSeededRng", () => {
  it("produces the same sequence for the same seed", () => {
    const a = createSeededRng(42);
    const b = createSeededRng(42);
    const seqA = Array.from({ length: 100 }, () => a());
    const seqB = Array.from({ length: 100 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces values in [0, 1)", () => {
    const rng = createSeededRng(7);
    for (let i = 0; i < 1000; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("produces a different sequence for a different seed", () => {
    const a = createSeededRng(1);
    const b = createSeededRng(2);
    const seqA = Array.from({ length: 100 }, () => a());
    const seqB = Array.from({ length: 100 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });
});
