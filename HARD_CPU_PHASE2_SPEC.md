# Hard CPU, Phase 2 spec: choke-point trap setup, nerf economy, 1-ply lookahead

Companion to `HARD_CPU_SPEC.md` (Phase 1). Phase 1's ship bar is unchanged:
final Hard must beat `full` ≥60% as South **and** ≥60% as North. Phase 1
measured, on spec seeds 200–219, both seats:

- v1 (danger-aware racing only): 10/20 both seats — 50%.
- v2 (+ score-first, generalized interception): 10/20 South, 8/20 North —
  18/40 (45%), flat within noise.

The read from v2: single-tile interception is weak because the threat's
Dijkstra route just goes around one blocker while Hard pays race tempo,
and score-first fires too rarely to carry an increment. Phase 2 therefore
moves off racing rules and onto the three levers Phase 1 deferred: where
traps start, when nerfs are spent, and what the opponent does next.

## 0. One mechanical truth that shapes all of Phase 2

A trap punishes; it does not block. An unrevealed trap is invisible to the
enemy's Dijkstra routing, so it shapes nothing — its entire value is the
probability the enemy steps on it. The exception is a revealed-but-live
trap (via trap sense), which *does* become a wall in enemy routing. So a
well-placed trap pays twice if it ever gets revealed: first as a gamble,
then as an actual roadblock.

A second consequence: nothing in Phase 2 changes trap mechanics. Counts
(10 per player), zones (own half + neutral row, max 3 neutral), and
validation all stay exactly as they are. Every placement below is
submitted through `applySetup`, so every existing check still applies.

## 1. Choke-point trap setup

### 1.1 What a choke point is

The defender's problem: the invader must travel from their back rows to
the defender's goal row, and the defender wants traps on tiles the
invader is most likely to step on.

**Locked definition — path-count (betweenness) ranking.** Build the
terrain-only land graph (plains/forest passable, water blocked; mystery
boxes don't block; no pieces — setup happens before pieces matter).
For each passable tile in the invader's back 3 rows, compute the
Dijkstra shortest path (terrain costs, the same machinery as
`findPath`) to the defender's goal row. A tile's **choke score** is the
number of those paths that pass through it. Rank trap-zone tiles by
choke score, descending.

Notes on the definition:

- Cut vertices (tiles whose removal disconnects entry from goal) are
  the special case where the choke score is total. They need no separate
  machinery — they rank first automatically.
- Ties in Dijkstra pathfinding are broken by the engine's existing
  first-found order, and placement ties are broken by the player's
  setup-seeded rng (the same stream `autoPlaceSetup` uses for that
  player: `seed + 101` north, `seed + 202` south). No new rng constant.
- The graph is terrain-only on purpose: it is deterministic, cheap
  (≤90 sources × Dijkstra over 930 tiles), and uses only public board
  information — the same information a human has at setup. No hidden
  info is involved, so this is fair play, not an engine exploit.

### 1.2 Allocation (tunable defaults, locked mechanism)

10 traps, filled in this order, each step skipping tiles already taken
and tiles the existing checks refuse (box tiles, piece tiles, the
neutral cap):

1. **Choke traps — 6.** The 6 highest choke-score tiles in the trap
   zone.
2. **Goal-row traps — 2.** The 2 highest choke-score tiles on the
   defender's goal row itself. The goal row is the limiting case of a
   choke: a trap there resolves *before* scoring, so it turns the
   invader's winning step into a death. Goal-row tiles are endpoints
   of the counted paths, so their choke score is the number of source
   paths ending there — a meaningful ranking, not a special case.
3. **Spread — 2.** Random passable trap-zone tiles, exactly as
   `autoPlaceSetup` does today. Coverage against boards where the
   choke ranking is flat (wide-open boards with no real funnels).

The 6/2/2 split is a starting default, not a locked truth. The first
measurement decides whether to tune it; the mechanism (ranking +
ordered fill) is what this spec locks.

### 1.3 Lab prerequisite: per-strategy setup

Today `createBattle` hardcodes `autoPlaceSetup` for both sides, so no
setup idea can be measured at all. Phase 2 first builds a **setup
strategy registry**, separate from the play registry:

- A setup strategy has a stable `id`, a `version` (bumped on behavior
  change, same convention as play strategies), and a `choose(state,
  player)` returning an `ApplySetupResult` — the same shape
  `autoPlaceSetup` returns.
- `createBattle` accepts a setup id per side, defaulting to `"auto"`
  (current behavior, version `auto@v1`). The choke placer registers as
  `"choke"`, version `choke@v1`.
- Play strategy and setup strategy stay independent: a tournament can
  pair hard-play + choke-setup against hard-play + auto-setup, which
  isolates the setup effect exactly the way Phase 1 isolated each play
  rule. The battle log's `game_start` entry records setup versions
  alongside play versions.
- Piece placement stays random in the choke placer (same
  `autoPlaceSetup` piece logic). Only trap placement changes, so the
  measurement attributes any edge to traps, not to pieces. Piece
  placement strategy is explicitly out of Phase 2 scope.
- Lab only for now. The local page's CPU setup keeps using
  `autoPlaceSetup` until the difficulty-select PR, which wires Hard's
  setup in for the Hard difficulty.

### 1.4 Measurement (setup)

- **Paired seeds:** same seed = same board. Compare choke-setup vs
  auto-setup with the *same* play strategy on both sides (first
  hard-play both sides, then full-play both sides as a control — if
  choke-setup helps only one play style, that's worth knowing).
- **Fresh seeds 300–319**, 20 per seat, both seats. Phase 1's 200–219
  range is retired for Phase 2 to avoid overfitting to it.
- **Leading indicator — trap-trigger rate:** what fraction of choke
  traps fire vs random traps, from battle-log trap events. If choke
  traps don't fire more often, the placement isn't doing anything
  regardless of win rate, and tuning the allocation is pointless until
  the ranking itself is fixed.
- **Win rate** is the deciding metric, against the same ≥60%-per-seat
  bar (for the final combined Hard; the setup-only comparison just
  needs a clear positive signal, not the full bar on its own).

## 2. Nerf economy: when to spend

### 2.1 Current behavior and the real tension

Today Hard (like `full`) nerfs on the first opportunity: any adjacent
enemy piece, most advanced first. The real tension is the token cap of
2 across usable + pending: scoring while at cap *wastes* a token, so
holding has a genuine cost — but spending on a piece 15 steps from
scoring is also waste, of a different kind.

### 2.2 Locked rule: spend threshold

Nerf only when one of these holds:

1. The target is within `NERF_SPEND_RANGE` steps of scoring
   (default **6**, tunable) — measured by the target's Dijkstra
   steps-to-goal, the same quantity the interception trigger uses.
2. **Or** the spender holds 2 usable tokens — spend to make room for
   the token the next score will earn, rather than wasting it at cap.

Otherwise hold. Nerf hunting is unchanged initially (it still routes
to manufacture adjacency against the top-2 runners): isolating one
variable — the spend decision — is the point. If measurement suggests
hunting is manufacturing nerfs the threshold then refuses, the hunt
gets the same range gate in a follow-up, not in this increment.

Play version bumps to `hard@v3` for this increment (play behavior
changes). Setup version is unaffected.

### 2.3 Measurement (economy)

Same paired-seed setup as §1.4 (fresh seeds 300–319, both seats):
threshold-spending vs always-spending, same play otherwise. Report
nerf-spend rate and wasted-token events alongside win rate — if the
threshold rarely binds (few adjacent targets outside range), it can't
move the needle and the range, not the rule, is what needs tuning.

## 3. Shallow 1-ply lookahead

### 3.1 Design

For each candidate action, simulate the action, then simulate the
opponent's best reply, evaluate the resulting position, and pick the
action that minimizes the opponent's evaluation. Concretely:

- **Candidates:** the current chooser's output set, ranked by the
  existing priority (nerf → scoring step → hunt → interception →
  danger race) — lookahead *ranks* candidates, it does not invent new
  ones. Take the top `LOOKAHEAD_CANDIDATES` (default **8**, tunable).
- **Opponent reply:** a single action from the opponent's policy
  (`full`'s chooser — the strongest cheap reply available), not a full
  search. One ply, not N-ply: this phase proves the machinery and the
  evaluation function before paying for depth.
- **Evaluation** (position score, higher = better for the player to
  move): score difference × `W_SCORE` + steps-to-goal difference
  (opponent's best minus own best) × `W_STEPS` + active-piece
  difference × `W_PIECES` + usable-token difference × `W_TOKENS`.
  Initial weights are **not locked here** — they are tuned on a small
  probe set (a few hundred positions from real games) before the
  tournament, because weights locked blind are just guesses. The
  structure (four terms, linear) is what's locked.
- **Fairness:** both simulations run from sanitized views. The
  opponent's simulated reply uses *their* sanitized view (traps hidden
  the same way). Lookahead must never read hidden traps — it is
  exactly as blind as the hand rules, just further ahead.
- **Interaction with hand rules:** lookahead subsumes interception
  and score-first naturally (a scoring action evaluates best, a
  blocking action evaluates well only if it actually delays). The hand
  rules stay regardless: they are cheap, and they provide the
  candidate ranking lookahead consumes. Removing them is a later
  simplification, not part of this increment.

### 3.2 Cost and perf gate

Branching is the risk: ~8 candidates × 1 opponent reply × Dijkstra
per piece per evaluation. Mitigations are the candidate cap above and
reusing `findPath` results within an evaluation. The gate is the same
as Phase 1's: **median action decision < 100 ms on lab hardware**.
If lookahead busts it, prune harder (fewer candidates) before
considering it a failure — and note the local page ticks every 350 ms,
so a 100 ms median leaves real headroom for live play.

Play version bumps to `hard@v4` for this increment.

### 3.3 Measurement (lookahead)

Same paired-seed setup (fresh seeds 300–319, both seats):
lookahead vs the same play without it. Report decision-time median
alongside win rate — a lookahead that wins but takes seconds is a lab
result, not a shippable CPU.

## 4. Rollout (one PR at a time, each measured before the next)

1. **Spec (this document).**
2. **Lab setup hook + choke placer + tests.** Measured per §1.4.
3. **Nerf economy (hard@v3) + tests.** Measured per §2.3.
4. **1-ply lookahead (hard@v4) + tests.** Measured per §3.3.
5. **Local page difficulty select (Normal/Hard, default Normal) +
   full Hard-vs-full tournament report.** This is where setup + play
   combine and the ≥60%-per-seat ship bar is judged.

## 5. Regression gates (every Phase 2 PR)

- Full suite green, tsc clean, ESLint clean, build succeeds.
- `full`'s code path untouched unless a PR says otherwise; the
  full-vs-pathfinder 15/20 reproduction on baseline seeds 100–109 is
  re-run whenever play code is touched (not needed for the setup-only
  PR, where play is identical by construction).
- Phase 1's v2 numbers (18/40 vs full, seeds 200–219) are the baseline
  for play changes; Phase 2 tournaments use fresh seeds 300–319.

## 6. Explicit non-goals for Phase 2

- No multi-ply search beyond 1-ply (that is a Phase 3 question, with
  its own perf case to make).
- No piece-placement strategy (pieces stay random; see §1.3).
- No Normal-difficulty changes (`full` + auto-setup stay the default).
- No trap-mechanic changes (counts, caps, zones, timing).
- No selective box-seeking as a Phase 2 item (Phase 1's step 4, still
  available, but the prior seeker evidence — 10/30 vs full at budget 4
  — makes it a weaker candidate than the three items above; it is not
  dropped, just sequenced after Phase 2 if the bar is still unmet).
