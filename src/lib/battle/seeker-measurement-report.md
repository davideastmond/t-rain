# Seeker measurement batch — results (2026-10-24)

Run headless with `runBattleGame` from the merged dev head (PR #49).
60 games: 15 each of seeker-vs-full, full-vs-seeker,
seeker-vs-pathfinder, pathfinder-vs-seeker (seeds 700001, 700101,
700201, 700301 respectively). `runBattleGame` is deterministic given
the seed (its strategy RNG seed defaults to a hash of it), so any of
these games can be replayed exactly.

Background: the 2026-10-23 tournament (30 games, pathfinder vs full)
produced 0.57 box collections/game and exactly one trap-sense roll,
because no strategy seeks boxes. `seeker` (full's composition with a
box detour inserted between spoiler mode and racing, gated on a
+4 detour budget) was built as a lab-only instrument to generate the
sample that organic play doesn't.

## Cost of seeking

- **Seeker vs full: 10/30 (33%) for the seeker.** Seeking loses 2:1
  against its non-seeking twin. n=30, so the 95% interval is wide
  (~17–53%), but the direction is unambiguous.
- **Seeker vs pathfinder: 19/30 (63%)**, vs full's 72% over pathfinder
  from the 2026-10-23 tournaments (43/60). Seeker is still clearly
  stronger than pure pathfinding, ~9 points weaker than full against
  the same opponent.
- Conclusion for the shipped CPU: do NOT ship seeking — it costs
  roughly a sixth to a fifth of win probability against an equal
  opponent. The lab-only scoping was the right call.
- All 60 games ended five-across (no attrition, no caps).
  Seeker-vs-full games run longer (63–65 turns) than
  seeker-vs-pathfinder (52–57), mirroring the full-vs-full grind
  (63.5).

## The instrument works

- **Collections: 78 in 60 games (1.30/game)** vs the 0.57/game organic
  baseline; **every game had at least one**. The seeker collected in
  all 60 games (1.00/game — exactly its own box, as designed).
  Opponents collected incidentally 18 times.
- First collection: mean turn 16.6 (median 16) — the beeline works.
- Seeker's own outcome mix (n=60): extra-steps 30 (50%), bridge 12
  (20%), **trap sense 15 (25%)**, booby 3 (5%) — vs design odds
  40/25/25/10. Trap sense lands exactly on its design rate; booby is
  low (3 vs 6 expected) but n=60 is too small to call that a deviation.
- All 3 booby deaths were seekers — expected, since seekers collect
  ~3x more than opponents.

## Trap sense — first real sample (n=18)

- **Same-turn trap death: 0/18.** The design guarantee holds
  empirically: sensing + revealed-trap routing keeps the collector
  alive through its turn. (Previously this was fixture-only evidence.)
- Collector scored later in the game: 9/18 (50%).
- Collecting side won: 7/18 (39%) — confounded, not a verdict: 15 of
  the 18 were seekers, and seekers lose 2:1 to full anyway (seeker
  trap-sense collections: side won 5/15). Seeker win rate in games
  with NO trap-sense collection was 23/43 (53%) — same confound in
  reverse. Trap sense neither demonstrably helps nor hurts at this
  sample size; what it demonstrably does is keep its collector alive.
- Booby deaths (3, all seekers) are the price side of the same coin.

## Nerf economy, unchanged story

- Nerfs: seeker 150 (2.5/game over 60 games), full 96 (3.2/game over
  30), pathfinder 0. Seekers nerf slightly less than full — early
  movement goes to the box run, not hunting.
- Trap deaths: seeker 1.90/game, full 2.00/game, pathfinder 1.63/game.
  The earlier "full dies to traps more" effect has washed out across
  batches — treat it as noise.
