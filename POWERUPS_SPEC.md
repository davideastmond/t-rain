# T-rain — Mystery boxes (spec, v1)

Status: decided 2026-10-20 (ideation 2026-10-20, from the bonus-pickups
suggestion in `suggestions.md`, which this spec supersedes). No code yet.
Implementation follows the nerf shape: engine → local UI → network → CPU.

## 1. Why

A human opponent's suggestion after a network game: bonus pickups on the
map. The design that emerged is not a known power-up but a **mystery
box**: a visible, contested raid target deep in enemy territory whose
contents are a gamble. It rewards the aggressive raid — push a piece
through trap country into the opponent's zone — which is already how
strong human play looks, and it gives a behind player a lever that isn't
just "race faster."

## 2. Concept

- **2 mystery boxes per game** — one mirrored pair (180° rotational
  symmetry, like terrain generation), one box in each player's zone.
- Boxes are **public**: both players always see both boxes.
- A box can only be collected by the player whose zone it is **not** in.
  For the home player the box is inert: their pieces may occupy or cross
  its tile and nothing happens.
- Consequence: each player can collect **at most one box per game**.
  One raid, one roll — no stacking questions ever arise.
- The box's contents are **unknown until collected**. Stepping onto the
  box tile (entry, like a trap) collects it and rolls:
  - **45% — Extra steps**
  - **45% — Water cross (bridge)**
  - **10% — Booby trap**: the collecting piece is eliminated.
- The box is consumed by the roll, whatever the outcome.

## 3. Generation

- Boxes are generated with the board at `createGame`, from the same
  seeded RNG stream, so a game (and its replays) is fully deterministic.
- Placement constraints for the pair:
  - One box per zone, at mirrored positions.
  - On a land tile (plains or forest — must be enterable).
  - Never in the back-3 setup rows, never on the goal row, never on the
    neutral row.
- A trap may **not** be placed on a mystery box tile (setup validation).
  Pieces are never placed on box tiles (boxes avoid the setup rows).

## 4. Extra steps (45%)

- The **collecting piece** gains **+2 free movement points**, usable
  **this turn only**.
- Free points are **not** drawn from the shared pool, and do **not**
  count toward the per-piece cap of 3: the piece may spend up to
  3 pool points + 2 free points in the collection turn.
- When the piece moves, its free points are spent **before** pool
  points (the box pays first, leaving the pool for other pieces).
- Unused free points expire at end of turn.
- The allowance is tied to the piece for the rest of the turn: the
  player may move other pieces and come back to spend the burst.

## 5. Water cross — bridge (45%)

- The collecting piece **holds a bridge** until it is used or the piece
  is eliminated (trap, nerf, drowning — the bridge is lost with it).
  Holding is public: the piece shows a bridge badge to both players.
- While holding, the piece may **enter a water tile at cost 1**
  (a normal pool-paid step; counts toward the per-piece cap). The
  bridge is consumed on entry.
- **One tile only**: from a water tile, the piece may only step onto
  land — it cannot enter a second water tile. A 2+-wide river remains
  uncrossable even with a bridge; bridges work at 1-wide crossings.
- **Must reach land the same turn**: if the turn ends with the piece on
  a water tile, the piece is **eliminated ("drowned")**, resolved at
  `endTurn` before the turn passes. Drowning counts toward attrition
  like any other elimination.
- A piece on water still occupies its tile (blocks movement) and can
  still be nerfed (adjacency is terrain-independent).
- With water costing 1, every 1-wide crossing fits the cap: worst case
  is a forest far bank, 1 + 2 = 3.

## 6. Booby trap (10%)

- The collecting piece is eliminated immediately; the box is consumed.
- The elimination counts toward attrition normally.
- This is **not** a trap for any other rule: no reveal mechanics (the
  box and its outcome are public), and it doesn't interact with the
  owner's trap count.

## 7. Interactions with existing rules

- **Traps**: collection is on entry, mid-turn, like trap resolution; the
  turn continues after any box outcome (unless attrition ends the game).
  A box tile never holds a trap (§3), so no ordering conflict exists.
- **Scoring**: boxes never sit on the goal row, so box-vs-score ordering
  never arises. A piece may collect and score in the same turn (e.g.
  extra-steps burst across the goal row) — normal scoring rules apply.
- **Nerf**: unaffected. Box effects are not nerf tokens and vice versa.
- **Attrition**: booby-trap and drowning eliminations count.
- **Determinism / network**: the roll is made by the engine from the
  game's RNG stream at collection time; in net games the outcome is
  part of the synced state and a typed event narrated to both players
  ("opponent's 🐱 opened a mystery box: 🌉 bridge!"). Battle logs record
  the outcome, so replays reproduce the game exactly.

## 8. Balance rationale

- The box's price is the raid itself: a piece deep in enemy territory,
  walking trap country both ways, plus a 10% chance the trip ends it.
  The reward distribution is deliberately swingy — 45% tempo (extra
  steps), 45% map-breaking (bridge at a chokepoint can be worth more
  than a piece), 10% disaster.
- Because each player gets at most one roll per game, a lucky roll is a
  highlight, not a snowball.
- Extra steps being piece-level (not pool-level) is deliberate: the
  reward lands on the piece that took the risk, as a slingshot deeper
  or an escape — not as a diffuse +2 spent anywhere on the board.

## 9. UI sketch (for the implementation PRs, no code here)

- Board: box tiles show 🎁. Collected boxes disappear.
- Bridge holders show a 🌉 badge on the piece.
- The spent readout for a piece with free points shows them distinctly
  (e.g. `3 + 2🎁`), and legal-step highlights account for free points.
- Narration (local feed + net events) for every collection outcome,
  including booby trap and drowning.

## 10. CPU hook

- v1: the CPU does not seek boxes. It collects accidentally when its
  route crosses the eligible box, and benefits automatically where the
  engine models the effect (free points in legal-step computation;
  pathfinding treats water as enterable at cost 1 for a bridge holder).
- Battle lab: box outcomes appear in the JSONL log; strategy versions
  unchanged (boxes are game rules, not strategy behavior).

## 11. Test plan (for the implementation PRs)

- Generation: over many seeds, exactly one mirrored pair, placement
  constraints hold, deterministic per seed.
- Collection: only the invader collects; home player crossing is inert;
  box consumed on every outcome.
- Extra steps: +2 free, spent before pool, cap interaction (3 + 2),
  expiry at end of turn, tied to the collecting piece only.
- Bridge: water entry at cost 1 consumes it; second water tile refused;
  drowning at endTurn (incl. attrition ending the game); bridge lost
  when the holder is eliminated any other way.
- Booby trap: elimination + attrition, box consumed.
- Net: outcome events reach both players; sanitized views show boxes
  and bridge holders.
- Replay: a logged game with box events replays to the same state.

## 12. Tuning knobs

- Roll distribution (45 / 45 / 10).
- Extra steps amount (+2).
- Box count (one mirrored pair).
- Water entry cost (1).
