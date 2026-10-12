// A tiny seeded random number generator.
//
// Board generation must be reproducible: the same seed has to produce the
// same board on your machine, on my machine, and later on a server —
// otherwise two players in an online game could be looking at different
// boards. `Math.random()` can't promise that, so the game carries its own
// generator and every random choice in the engine draws from it.
//
// This is mulberry32, a well-known public-domain algorithm. It holds one
// 32-bit integer of state and scrambles it a little more on every call.

/** A random source: each call returns the next number in [0, 1), like Math.random(). */
export type SeededRng = () => number;

export function createSeededRng(seed: number): SeededRng {
  // `>>> 0` forces the seed into an unsigned 32-bit integer, whatever was passed in.
  let state = seed >>> 0;

  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;

    let t = state;
    // Math.imul is 32-bit integer multiplication. Plain `*` uses floats and
    // would quietly lose the low bits this scrambling depends on.
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    // Final scramble, back to unsigned, scaled into [0, 1).
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
