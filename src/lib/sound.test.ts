// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { scenarioGame } from "./game/test-helpers";
import type { StepOutcome } from "./game/movement";
import type { NetEvent } from "./net/store";
import {
  isMuted,
  netEventSounds,
  playSound,
  setMuted,
  soundForStepOutcome,
  subscribeMuted,
  type QueuedSound,
} from "./sound";

// Phase 3c (TEST_PLAN.md): sound mappings only. playSound itself is
// not tested for output (Web Audio in jsdom is a stub at best) —
// only that it no-ops safely and respects the mute flag.

function outcome(patch: Partial<StepOutcome>): StepOutcome {
  return {
    cost: 1,
    eliminated: false,
    scored: false,
    box: null,
    revealed: [],
    pickup: null,
    ...patch,
  };
}

let seq = 0;
/** A net event before seq/at are assigned. Plain Omit would collapse
    the union to its common keys, so distribute it per variant. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
type EventWithoutMeta = DistributiveOmit<NetEvent, "seq" | "at">;
function event(partial: EventWithoutMeta): NetEvent {
  return {
    ...partial,
    seq: ++seq,
    at: new Date().toISOString(),
  } as NetEvent;
}

const state = scenarioGame();

describe("soundForStepOutcome priority", () => {
  it("plays trap over box and score", () => {
    expect(
      soundForStepOutcome(outcome({ eliminated: true, box: "booby-trap", scored: true })),
    ).toBe("trap");
  });

  it("plays box over score", () => {
    expect(
      soundForStepOutcome(outcome({ box: "extra-steps", scored: true })),
    ).toBe("box");
  });

  it("plays score, then plain move", () => {
    expect(soundForStepOutcome(outcome({ scored: true }))).toBe("score");
    expect(soundForStepOutcome(outcome({}))).toBe("move");
  });
});

describe("netEventSounds", () => {
  it("is silent without a seat", () => {
    expect(
      netEventSounds(
        [event({ type: "step", pieceId: "south-cat", from: { x: 0, y: 27 }, to: { x: 0, y: 26 }, cost: 1 })],
        state,
        null,
      ),
    ).toEqual([]);
  });

  it("plays one move sound per uncovered step, soft for the opponent's", () => {
    expect(
      netEventSounds(
        [event({ type: "step", pieceId: "south-cat", from: { x: 0, y: 27 }, to: { x: 0, y: 26 }, cost: 1 })],
        state,
        "south",
      ),
    ).toEqual([{ name: "move", soft: false, delayMs: 0 }]);
    expect(
      netEventSounds(
        [event({ type: "step", pieceId: "north-cat", from: { x: 0, y: 2 }, to: { x: 0, y: 3 }, cost: 1 })],
        state,
        "south",
      ),
    ).toEqual([{ name: "move", soft: true, delayMs: 0 }]);
  });

  it("skips a step covered by a terminal event for the same piece", () => {
    const step = event({ type: "step", pieceId: "south-cat", from: { x: 0, y: 27 }, to: { x: 0, y: 26 }, cost: 1 });
    expect(
      netEventSounds(
        [step, event({ type: "trap-triggered", position: { x: 0, y: 26 }, victimPieceId: "south-cat" })],
        state,
        "south",
      ),
    ).toEqual([{ name: "trap", soft: false, delayMs: 0 }]);
    expect(
      netEventSounds(
        [step, event({ type: "scored", pieceId: "south-cat", player: "south", scores: { north: 0, south: 1 } })],
        state,
        "south",
      ),
    ).toEqual([{ name: "score", soft: false, delayMs: 0 }]);
  });

  it("still plays a step when the terminal event is for another piece", () => {
    expect(
      netEventSounds(
        [
          event({ type: "step", pieceId: "south-cat", from: { x: 0, y: 27 }, to: { x: 0, y: 26 }, cost: 1 }),
          event({ type: "trap-triggered", position: { x: 1, y: 26 }, victimPieceId: "south-dog" }),
        ],
        state,
        "south",
      ),
    ).toEqual([
      { name: "move", soft: false, delayMs: 0 },
      { name: "trap", soft: false, delayMs: 0 },
    ]);
  });

  it("maps trap, score, and drown with the volume rule", () => {
    const cases: Array<[NetEvent, QueuedSound]> = [
      [
        event({ type: "trap-triggered", position: { x: 0, y: 26 }, victimPieceId: "north-cat" }),
        { name: "trap", soft: true, delayMs: 0 },
      ],
      [
        event({ type: "scored", pieceId: "north-cat", player: "north", scores: { north: 1, south: 0 } }),
        { name: "score", soft: true, delayMs: 0 },
      ],
      [
        event({ type: "piece-drowned", player: "south", pieceId: "south-cat" }),
        { name: "drown", soft: false, delayMs: 0 },
      ],
      [
        event({ type: "piece-drowned", player: "north", pieceId: "north-cat" }),
        { name: "drown", soft: true, delayMs: 0 },
      ],
    ];
    for (const [input, expected] of cases) {
      expect(netEventSounds([input], state, "south")).toEqual([expected]);
    }
  });

  it("makes getting nerfed full and nerfing soft", () => {
    expect(
      netEventSounds(
        [event({ type: "nerfed", player: "north", targetPieceId: "south-cat" })],
        state,
        "south",
      ),
    ).toEqual([{ name: "nerf", soft: false, delayMs: 0 }]);
    expect(
      netEventSounds(
        [event({ type: "nerfed", player: "south", targetPieceId: "north-cat" })],
        state,
        "south",
      ),
    ).toEqual([{ name: "nerf", soft: true, delayMs: 0 }]);
  });

  it("maps box outcomes with tails, and booby to trap alone", () => {
    expect(
      netEventSounds(
        [event({ type: "box-collected", player: "south", pieceId: "south-cat", outcome: "extra-steps" })],
        state,
        "south",
      ),
    ).toEqual([
      { name: "box", soft: false, delayMs: 0 },
      { name: "bonus", soft: false, delayMs: 180 },
    ]);
    expect(
      netEventSounds(
        [event({ type: "box-collected", player: "north", pieceId: "north-cat", outcome: "bridge" })],
        state,
        "south",
      ),
    ).toEqual([
      { name: "box", soft: true, delayMs: 0 },
      { name: "bridge", soft: true, delayMs: 180 },
    ]);
    expect(
      netEventSounds(
        [event({ type: "box-collected", player: "south", pieceId: "south-cat", outcome: "booby-trap" })],
        state,
        "south",
      ),
    ).toEqual([{ name: "trap", soft: false, delayMs: 0 }]);
    // Trap sense's shimmer is viewer-derived, never event-driven.
    expect(
      netEventSounds(
        [event({ type: "box-collected", player: "south", pieceId: "south-cat", outcome: "trap-sense" })],
        state,
        "south",
      ),
    ).toEqual([{ name: "box", soft: false, delayMs: 0 }]);
  });

  it("plays the turn sound only when the opponent ends their turn", () => {
    expect(
      netEventSounds(
        [event({ type: "turn-ended", player: "north" })],
        state,
        "south",
      ),
    ).toEqual([{ name: "turn", soft: false, delayMs: 0 }]);
    expect(
      netEventSounds(
        [event({ type: "turn-ended", player: "south" })],
        state,
        "south",
      ),
    ).toEqual([]);
  });

  it("plays win/lose at 300 ms for game-finished", () => {
    expect(
      netEventSounds(
        [event({ type: "game-finished", winner: "south", reason: "crossed" })],
        state,
        "south",
      ),
    ).toEqual([{ name: "win", soft: false, delayMs: 300 }]);
    expect(
      netEventSounds(
        [event({ type: "game-finished", winner: "north", reason: "forfeit" })],
        state,
        "south",
      ),
    ).toEqual([{ name: "lose", soft: false, delayMs: 300 }]);
  });

  it("is silent for lobby and forfeit events on their own", () => {
    expect(
      netEventSounds(
        [
          event({ type: "game-created" }),
          event({ type: "player-joined", player: "north" }),
          event({ type: "setup-submitted", player: "south" }),
          event({ type: "forfeited", player: "north" }),
        ],
        state,
        "south",
      ),
    ).toEqual([]);
  });
});

describe("playSound safety and mute", () => {
  it("no-ops safely without an audio context", () => {
    expect(() => playSound("move")).not.toThrow();
    expect(() => playSound("win", true)).not.toThrow();
    expect(() => playSound("terraform")).not.toThrow();
  });

  it("persists the mute flag in localStorage", () => {
    setMuted(true);
    expect(isMuted()).toBe(true);
    expect(window.localStorage.getItem("train-muted")).toBe("1");
    setMuted(false);
    expect(isMuted()).toBe(false);
    expect(window.localStorage.getItem("train-muted")).toBe("0");
  });

  it("notifies subscribers until they unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMuted(listener);
    setMuted(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setMuted(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("respects the mute flag in playSound", () => {
    setMuted(true);
    expect(() => playSound("move")).not.toThrow();
    setMuted(false);
  });

  it("reads a persisted flag on first read", async () => {
    // Last: a fresh module instance has no cache, so isMuted must read
    // the stored value rather than a default.
    vi.resetModules();
    window.localStorage.setItem("train-muted", "1");
    const fresh = await import("./sound");
    expect(fresh.isMuted()).toBe(true);
    window.localStorage.setItem("train-muted", "0");
  });
});
