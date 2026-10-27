# Hard CPU Spec

A stronger CPU opponent for T-rain, shipped as a difficulty tier — not as
a replacement. The current CPU (`full@v4`, see `CPU_STRATEGY.md`) stays
exactly as it is and becomes **Normal**. **Hard** is a new strategy that
beats it. This doc is the design and the acceptance bar; the implementation
lands in later PRs, one piece at a time, each measured in the battle lab
before the next starts.

## Why: the baseline

Two measurements, both from 2026-10-26, motivate this work:

- **Tournament (40 full games, seeds 100–109, both seats).** `full`
  beats `pathfinder` 15/20 (9/10 as South, 6/10 as North — small sample,
  don't over-read the seat split) and beats `greedy` 20/20. Average game
  ~53–56 turns, no draws. So the nerf + nerf-hunt + spoiler package is
  worth roughly +25 points over pure Dijkstra pathfinding.
- **Hands-on play (6 turns, South vs the shipped CPU, seed 42).** The CPU
  is a clean racer: full 10/10 pool every turn, pieces run to their
  3-step cap, routes detour sensibly around water and forest. But it is
  one-dimensional: the same 3–4 runners down their cheapest routes, no
  blocking outside the narrow spoiler window, no probing, no adaptation.
  In one turn it lost two pieces to traps (alien on (29,17), mouse on
  (21,15)) and carried on — correct under hidden information, but it
  shows the asymmetry a human exploits: human trap placement aims at
  choke points, while the CPU's setup is uniformly random
  (`autoPlaceSetup`).

Read together: `full`'s margin over pure pathfinding is modest, and a
decent human adds everything pathfinding lacks (aimed traps, blocking,
box play, danger sense). A human who has played twice starts farming it.
Hard exists to close that gap.

## Non-goals and constraints

- **Normal does not change.** `full@v4`'s behavior, and the local page's
  default, stay exactly as they are. Hard is opt-in via a difficulty
  select on the local page (default Normal).
- **The fairness rule is inherited, not relaxed.** Hard decides only
  from `sanitizeForPlayer(state, player)` — the same view an online
  server would send a client. It never reads the opponent's untriggered
  traps, and any memory it builds comes from public events (triggered
  traps, scores, revealed-to-viewer sets) only. This is the same cardinal
  rule as `src/lib/game/cpu.ts`, and it is what keeps Hard honest
  against a human: it wins by playing better, not by peeking.
- **Versioning follows the lab convention** (`src/lib/battle/strategies.ts`):
  Hard is strategy id `"hard"`, version `"hard@v1"`, and the version
  string bumps whenever its behavior changes, so tournament logs stay
  comparable across tweaks.
- **Phase 1 is in-game decisions only.** Setup (trap and piece placement)
  is deliberately out of scope for v1 — see "Phase 2" below. Both sides
  keep using `autoPlaceSetup` in measurement, so Hard's edge is provably
  from how it plays, not how it sets up.

## Hard's design (Phase 1)

Hard reuses `full`'s composition and upgrades the pieces that the
baseline showed to be thin. Priority order per action, highest first:

### 1. Nerf — unchanged from `full`

When holding a usable token with pool to spend, eliminate the valid
target closest to scoring (`nerfTargets` + most-advanced pick, as in
`chooseCpuAction`). This already works; don't touch it.

### 2. Score if possible — new, explicit

If any legal step scores this turn, take the cheapest such step. `full`
usually scores anyway (a scoring step tends to be the cheapest route),
but once interception and danger penalties sit above racing in the
order, scoring must outrank them explicitly — never let a block or a
dodge cost a point on the board.

### 3. Nerf hunting — unchanged from `full`

When holding a token but nothing is adjacent yet, route a piece next to
a top runner so the nerf fires later this same turn
(`chooseNerfHuntStep`, including its same-turn feasibility checks: route
fits the per-piece cap and leaves `NERF_POOL_COST` in the pool).
Unchanged because the baseline gave no evidence against it.

### 4. Interception, generalized — replaces bounded spoiler mode

`full`'s spoiler mode only fires in a narrow window (opponent needs 1,
Hard needs 2+). Hard intercepts earlier and more often:

- **Trigger.** Intercept when the opponent's most advanced runner is
  within `INTERCEPT_RANGE` steps of scoring (default 6, tunable) AND
  Hard's own best runner is at least `INTERCEPT_BEHIND` steps further
  from scoring (default 3, tunable) — i.e. when the opponent is
  genuinely ahead, not on every turn. When Hard is ahead or tied, it
  races; interception is a comeback tool, not a default, because
  standing on a path costs the interceptor its own race.
- **Mechanics.** Reuse `chooseSpoilerStep`'s approach (route the
  fastest piece onto the threat's path; cheapest interception first,
  then earliest tile on the threat's path, then tiles not adjacent to
  an enemy piece), with the trigger above replacing `isSpoilerMode`.
  The old spoiler behavior becomes the special case
  (`INTERCEPT_RANGE` covering the 1-vs-2+ window), so nothing is lost.
- **Tuning note.** If measurement shows Hard stalling its own race by
  intercepting too eagerly, tighten the trigger (raise
  `INTERCEPT_BEHIND`, lower `INTERCEPT_RANGE`) before touching the
  mechanics.

### 5. Selective box-seeking — tightly gated

The seeker experiment (`seeker-measurement-report.md`) already proved
blanket seeking loses about 2:1 against its non-seeking twin, so Hard
does NOT adopt the seeker's budget. It seeks only when ALL of these
hold:

- Hard is not one score from winning (race instead — same rule the
  nerf hunt uses).
- No scoring step is available this turn (rule 2 already took it).
- The box route's detour is tiny: route-to-box cost ≤ route-to-goal
  cost + `HARD_SEEK_BUDGET`, with `HARD_SEEK_BUDGET` default 2
  (tighter than the seeker's 4) — a genuine bargain, not a detour.
- The box is collectible by Hard (invader-only rule, as in
  `chooseSeekStep`: the box in the opponent's zone).

Mechanics reuse `chooseSeekStep` with the tighter budget. If measurement
shows even budget-2 seeking costs games, the gate tightens to 1 or the
rule is dropped — seeking is the first thing cut, not the last thing
defended.

### 6. Danger-aware racing — replaces plain `chooseCpuStep`

When none of the above fires, Hard races — but on a danger-weighted
map, not the plain one:

- **Danger tiles.** A tile orthogonally adjacent to an enemy piece is
  dangerous when that enemy's owner holds a usable nerf token
  (`nerfTokens[foe] ≥ 1` and pool to spend it — the exact condition
  under which `nerfTargets` could include a piece ending there).
  Ending a step on a dangerous tile costs `DANGER_COST` extra
  (default 2, tunable) in the route comparison. It is a penalty, not a
  wall: Hard still steps onto a dangerous tile when the route is
  otherwise clearly best (e.g. the scoring step — which rule 2 already
  took anyway).
- **Implementation shape.** A Hard-only path chooser in a new module
  (proposed: `src/lib/game/cpu-hard.ts`) that delegates to the shared
  `findPath` machinery where possible and applies the danger penalty
  in its own candidate comparison. `findPath` itself, and therefore
  `full`'s behavior, must not change.
- **Candidate comparison.** Among legal first steps, prefer: lowest
  danger-adjusted route cost, then fewest steps (same tiebreak spirit
  as `chooseCpuStep`), then seeded randomness among ties. The per-piece
  cap, pool, and newly-appeared blockers are respected exactly as in
  `full` (a route only counts if its first step is legal right now).

## What Hard deliberately does NOT do (yet)

- **No multi-turn search.** Every decision is still one tick deep.
  A shallow lookahead over pool allocation is the obvious next step
  after v1, but it is a separate design with its own cost/benefit
  measurement — not smuggled into this spec.
- **No trap memory beyond public events.** Hard does not track "this
  area killed a piece before, avoid it" — each hidden trap is a single
  tile, and a death reveals only that tile (which becomes harmless
  once triggered). Any future trap-inference design needs its own
  evidence that a signal actually exists in random placement.
- **No box-outcome chasing.** Box contents are random; Hard values the
  box tile, never a hoped-for outcome. (Bridge and trap sense change
  routes after collection through the existing engine rules, which
  Hard inherits for free.)

## Measurement plan and ship bar

All measurement uses the battle lab (`src/lib/battle/`), full games to
completion, both seats, fresh seeds **200–219** (20 games per seat, 40
total — a different range from the baseline so no seed is reused
across the comparison):

1. **Hard vs `full`.** Ship bar: Hard wins **≥ 60% as South AND
   ≥ 60% as North**. Both seats, not just overall — a CPU that only
   wins from one seat is a board artifact, not a stronger player.
   Draws (turn-cap hits) count as not-wins.
2. **Hard vs `pathfinder`** (sanity check). Hard must beat pathfinder
   by more than `full`'s 15/20 — otherwise the new machinery is not
   pulling its weight.
3. **Performance gate.** The local page plays one CPU step per 350 ms
   tick, so Hard's decision time must stay interactive: median action
   decision under 100 ms on lab hardware, measured across a
   tournament. If danger weighting or interception routing blows past
   that, the design is simplified before it ships, not after.
4. **Regression gate.** The existing suite stays green (`npm test`,
   `tsc`, `eslint`, `next build`), and `full`'s behavior is verified
   unchanged: `full` vs `pathfinder` on the baseline seeds must
   reproduce 15/20 (deterministic strategies, same seeds — any drift
   means Hard's code leaked into `full`'s path).

If Hard misses the ship bar, the levers in order are: tighten the
seek gate, tighten the interception trigger, retune `DANGER_COST` —
and if none of those close it, the design goes back to the drawing
board rather than shipping a "Hard" that isn't.

## Rollout (planned PRs, one at a time)

1. **This PR: the spec.** No behavior change.
2. **Lab strategy + danger-aware racing** (rule 6 + registry entry +
   tests): the largest single piece, measured alone against `full`.
3. **Generalized interception** (rule 4 + scoring-first rule 2 +
   tests), measured on top of (2).
4. **Selective seeking** (rule 5 + tests), measured on top of (3) —
   first candidate for cutting if it costs games.
5. **Local page difficulty select** (Normal/Hard, default Normal) +
   the full Hard-vs-`full` tournament report. Only then does Hard
   reach players.

## Phase 2 (future work, not this spec's scope)

- **Choke-point trap setup.** Place traps where the opponent's
  Dijkstra routes actually funnel (narrow land corridors, bridge
  crossings, goal-row approaches) instead of uniformly at random.
  Blocked on lab support: `createBattle` currently auto-places both
  sides identically, so a per-strategy setup needs a lab change first
  (setup chooser per strategy id) before it can be measured fairly.
- **Nerf economy.** Today a token is spent the moment a target is
  adjacent. A stronger version might hold a token when no target is
  within striking distance of scoring — but the token cap (2 across
  usable + pending) punishes hoarding, so this needs its own
  measurement before it earns a place.
- **Shallow lookahead.** One-ply evaluation of end-of-turn positions
  (score difference, advancement sum, pieces alive) over candidate
  first actions. The most powerful item on this list and the most
  expensive; only after v1 ships and its bar is met.

Phase 2 is now specified in full: see `HARD_CPU_PHASE2_SPEC.md`
(choke-point trap setup with a path-count choke ranking, nerf economy
with a spend threshold, and 1-ply lookahead), including the lab
per-strategy setup hook, fresh measurement seeds 300–319, and the
one-PR-at-a-time rollout.
