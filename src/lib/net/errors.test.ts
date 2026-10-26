import { describe, expect, it } from "vitest";

import { errorStatus } from "./errors";

// Phase 2a (TEST_PLAN.md): engine error → HTTP status mapping.

describe("errorStatus", () => {
  it.each(["wrong-phase", "not-your-turn", "already-setup"])(
    "maps %s to 403",
    (error) => {
      expect(errorStatus(error)).toBe(403);
    },
  );

  it.each([
    "piece-outside-zone",
    "trap-outside-zone",
    "wrong-piece-count",
    "wrong-trap-count",
    "duplicate-character",
    "duplicate-position",
    "on-water",
    "on-mystery-box",
    "too-many-neutral-traps",
    "piece-not-found",
    "not-adjacent",
    "occupied",
    "exceeds-piece-cap",
    "invalid-target",
    "no-token",
    "insufficient-points",
    "something-entirely-unknown",
  ])("maps %s to 400", (error) => {
    expect(errorStatus(error)).toBe(400);
  });
});
