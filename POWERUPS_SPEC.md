# T-rain — Mystery boxes (spec, v2)

Status: v1 decided 2026-10-20 (ideation 2026-10-20, from the bonus-pickups
suggestion in `suggestions.md`, which this spec supersedes) and implemented
2026-10-20/21 (engine, local UI, network, CPU + battle lab). **v2 amendment
decided 2026-10-22: a fourth box outcome, trap sense (§6), and the roll
distribution moves to 40 / 25 / 25 / 10.** Trap sense is not yet
implemented; it follows the same shape: engine → local UI → network → CPU.

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
  - **40% — Extra steps**
  - **25% — Water cross (bridge)**
  - **25% — Trap sense** (v2, §6)
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

## 4. Extra steps (40%)

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

## 5. Water cross — bridge (25%)

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
- A water tile **never scores**, even on the goal row — a crossing only
  counts once the piece reaches land.
- A piece on water still occupies its tile (blocks movement) and can
  still be nerfed (adjacency is terrain-independent).
- With water costing 1, every 1-wide crossing fits the cap: worst case
  is a forest far bank, 1 + 2 = 3.

## 6. Trap sense (25%) — v2

- The collecting piece gains **trap sense** for the **remainder of the
  collection turn**. Holding it is public: the piece shows a 🔍 badge
  for the rest of the turn, like the 🌉 badge for a bridge.
- While the piece holds trap sense, traps are **sensed** at these
  moments:
  1. On collection, at the box tile.
  2. After each step the sensing piece takes for the rest of the turn,
     at its new position.
  At each sensing moment, the four orthogonal (N/S/E/W) tiles adjacent
  to the piece are checked. Sensing is tied to the *piece*: moving
  other pieces does not sense, and the sense does not transfer.
- Any **opponent trap** found on a checked tile is **revealed to the
  collecting player only — permanently** (for the rest of the game).
  The sensor expires at end of turn; the reveals do not. Revealed
  traps join that player's revealed set and render on their board
  from then on.
- A revealed trap is **not disarmed**. It stays live, and stepping
  onto it later — by any piece, including the scout — fires it as
  normal. What the sense buys is certainty: while it lasts, the
  sensing piece can never *unknowingly* step on a trap, because every
  legal destination is orthogonally adjacent and is therefore checked
  before the step.
- The sense ends early if the piece is eliminated or scores. Reveals
  already made are kept.
- **Privacy:** the roll outcome is public (narrated to both players,
  like every box outcome). The revealed *positions* are private: a
  player's sanitized view shows a trap iff it is their own, already
  triggered, or in their own revealed set — and a sanitized view never
  carries the opponent's revealed set. No "trap revealed" entry is
  written to the shared network event log (it would leak the
  position); the collector's client derives reveal announcements from
  its own state diff.
- **Ordering:** inside a step, trap sense resolves after the mystery
  box (cost → trap → box → sense → scoring → win/loss). A box tile
  never holds a trap (§3), so the collection sensing can never
  coincide with a trap firing on the same tile.

## 7. Booby trap (10%)

- The collecting piece is eliminated immediately; the box is consumed.
- The elimination counts toward attrition normally.
- This is **not** a trap for any other rule: no reveal mechanics (the
  box and its outcome are public), and it doesn't interact with the
  owner's trap count.

## 8. Interactions with existing rules

- **Traps**: collection is on entry, mid-turn, like trap resolution; the
  turn continues after any box outcome (unless attrition ends the game).
  A box tile never holds a trap (§3), so no ordering conflict exists.
- **Scoring**: boxes never sit on the goal row, so box-vs-score ordering
  never arises. A piece may collect and score in the same turn (e.g.
  extra-steps burst across the goal row) — normal scoring rules apply.
- **Nerf**: unaffected. Box effects are not nerf tokens and vice versa.
  A nerfed scout loses trap sense with the piece, but its reveals stay
  known.
- **Attrition**: booby-trap and drowning eliminations count.
- **Determinism / network**: the roll is made by the engine from the
  game's RNG stream at collection time; in net games the outcome is
  part of the synced state and a typed event narrated to both players
  ("opponent's 🐱 opened a mystery box: 🌉 bridge!"). Battle logs record
  the outcome, so replays reproduce the game exactly.
- **Trap sense (v2)**: sensing is a pure function of state (trap
  positions + the sensing piece's path) — no new RNG — so replays
  reproduce every reveal exactly. The roll stream is unchanged
  (seed + 404 + boxRolls); only the chance thresholds move. No stacking
  question arises: each player collects at most one box per game, so a
  player only ever holds one box outcome, and a single roll grants
  exactly one outcome.

## 9. Balance rationale

- The box's price is the raid itself: a piece deep in enemy territory,
  walking trap country both ways, plus a 10% chance the trip ends it.
  The reward distribution is deliberately swingy — 40% tempo (extra
  steps), 25% map-breaking (bridge at a chokepoint can be worth more
  than a piece), 25% information (trap sense — v2), 10% disaster.
  Extra steps stays the most common outcome because it is the only one
  that is always useful; bridge and trap sense are both conditional
  but potentially game-changing, so they split the rest evenly.
- Trap sense is balanced by its clock: the sensor lasts only the
  remainder of the collection turn, so the trap immunity it grants
  the scout can never become a multi-turn escort. The permanent
  reveals are the consolation floor — even a collector who arrives
  with no movement left learns the traps guarding the box exits.
- Because each player gets at most one roll per game, a lucky roll is a
  highlight, not a snowball.
- Extra steps being piece-level (not pool-level) is deliberate: the
  reward lands on the piece that took the risk, as a slingshot deeper
  or an escape — not as a diffuse +2 spent anywhere on the board.

## 10. UI sketch (for the implementation PRs, no code here)

- Board: box tiles show 🎁. Collected boxes disappear.
- Bridge holders show a 🌉 badge on the piece.
- The spent readout for a piece with free points shows them distinctly
  (e.g. `3 + 2🎁`), and legal-step highlights account for free points.
- Narration (local feed + net events) for every collection outcome,
  including booby trap and drowning.
- Trap sense (v2): the sensing piece shows a 🔍 badge for the rest of
  the turn; traps in the viewer's revealed set render for that viewer
  only (💣, as their own traps do); narration covers the public roll,
  and the collecting client adds its own reveal line from its state
  diff (never a shared event).

## 11. CPU hook

- v1: the CPU does not seek boxes. It collects accidentally when its
  route crosses the eligible box, and benefits automatically where the
  engine models the effect (free points in legal-step computation;
  pathfinding treats water as enterable at cost 1 for a bridge holder).
- Battle lab: box outcomes appear in the JSONL log; strategy versions
  unchanged (boxes are game rules, not strategy behavior).
- Trap sense (v2): the CPU decides from its sanitized view, which
  includes its own revealed traps. Routing around revealed traps is a
  follow-up hook (pathfinding treats traps visible in the sanitized
  view as blocked); until then a CPU trap-sense roll reveals traps it
  does not yet use.

## 12. Test plan (for the implementation PRs)

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
- Trap sense (v2): roll thresholds — extra steps < 0.40, bridge < 0.65,
  trap sense < 0.90, booby trap otherwise; the collection snapshot and
  each later step by the sensing piece reveal orthogonally adjacent
  opponent traps (diagonals are not sensed, other pieces' steps do not
  sense); reveals persist past end of turn and the scout's elimination
  while the sense itself expires at end of turn; a revealed trap still
  fires when stepped on; sanitized views include the viewer's revealed
  traps and never the opponent's revealed set; the net event log gains
  no position-bearing reveal entry.

## 13. Tuning knobs

- Roll distribution (40 / 25 / 25 / 10).
- Extra steps amount (+2).
- Box count (one mirrored pair).
- Water entry cost (1).
- Trap sense duration (remainder of the collection turn) and shape
  (orthogonal, range 1).
