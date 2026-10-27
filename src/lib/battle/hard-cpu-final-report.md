# Hard CPU — final report (Phase 2)

Ship verdict: **Hard ships.** The final combined tournament clears the
ship bar on both seats (see below). Hard is the local page's Hard
difficulty: hard@v4 play + choke setup. Normal is unchanged (full play +
auto setup) and stays the default.

## The tiers

- **Normal** — full@v4 play (the shipped CPU: nerf → nerf-hunt → bounded
  spoiler → race) + auto setup (random traps).
- **Hard** — hard@v4 play (v2's danger-aware racing, score-first, and
  generalized interception, ranked by 1-ply lookahead over those same
  hand-rule candidates) + choke setup (6 choke-point traps, 2 goal-row
  traps, 2 random spread).

## Measurement history (paired seeds 300–319 unless noted)

| Experiment | Result | Read |
| --- | --- | --- |
| Choke setup vs auto, same play both sides | Choke side 30/40 with hard play, 36/40 with full play; choke traps fired 237 vs auto 170 | Setup edge is real and play-independent |
| hard@v3 nerf threshold vs v2 | v3 wins 14/40, spends 85 nerfs vs v2's 122 | Holding wastes fleeting nerf opportunities |
| hard@v3 + hunt gate vs v2 | v3 wins 15/40, spend counts identical at 85 | Refused nerfs, not hunt waste, are the cost — threshold dead after two shots, never shipped |
| hard@v4 lookahead vs v2 (choke both sides) | v4 wins 14/20 South, 11/20 North (1 draw) = 25/40; decision-time median 85 ms (gate < 100 ms), max 109 ms | Real improvement over v2; North seat weaker |
| **Final: Hard tier vs Normal tier** | **Hard wins 18/20 as South, 15/20 as North = 33/40** | **Ship bar (≥ 60% per seat) passed on both seats** |

All tournaments use `createBattle` with per-side play + setup ids, so
the tiers measured are exactly the tiers the difficulty select offers.

## Why Hard wins

Two independent edges stack: choke setup wins on its own (it fires ~39%
more traps than auto), and lookahead's reply-awareness beats v2's
hand-rule priority. Neither play rule alone ever cleared 50% against
full; the combination clears 60% per seat against it.

## Known limitations

- **1-ply horizon.** Lookahead cannot price multi-turn plans: hunting a
  distant runner and trekking toward a threat path both move away from
  the goal this turn, so racing wins those evaluations. Hunt and
  interception rarely fire under v4. The tournament above is the
  evidence that reply-awareness compensates on net.
- **North seat weaker.** Hard wins 75% as North vs 90% as South in the
  final tournament (and 55% as North vs v2 in the intermediate one).
  North moves first on a mirrored board, so seat asymmetry is structural
  to some degree, but it is the seat to watch if Hard ever regresses.
- **Evaluation weights are initial, not tuned.** Score 1000 (deliberately
  above the ~381 maximum positional swing, so a point always beats
  position), steps 10, pieces 5, tokens 3. No weight search was run; a
  future tuning pass could try to close the North gap.
- **Selective seeking is still out.** The seeker measurement (10/30 vs
  full at ~2:1 cost) stands: the shipped CPU never seeks boxes, on
  either tier.
