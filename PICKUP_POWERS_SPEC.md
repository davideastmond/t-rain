# T-rain — Pickup powers (spec, v1)

## 1. Why

Mystery boxes are visible, mirrored, and invader-only. Pickup powers are
the opposite kind of spice: a single random event, invisible to both
players, that either player may stumble onto — or that nobody finds at
all. The variance is the feature. One item per game keeps it a
sideshow, not a second economy.

## 2. Concept

- **One pickup per game.** Its kind is randomly determined, 50/50:
  - **Trap** — an extra trap, placed by the collector (see §5). Called
    "trap", not "bomb", because it works exactly like a trap.
  - **Terraform** — turn one water or forest tile into a plains tile
    (see §6).
- The pickup is **invisible** until collected: it is never drawn on the
  board, and no sanitized view contains it.
- A collected power **must be used the same turn** it was collected,
  and using it costs pool points. Collecting with too few points left
  means it simply expires unused (§7).

## 3. Generation — deliberately NOT seed-dependent

The engine is deterministic (seed + move history = the whole game),
and this feature deliberately breaks that for one item only. The break
is contained, not total:

- `createGame` stays seed-pure and places **no** pickups, so seeded
  tests and board generation are untouched.
- Placement is a separate step that runs when the game flips from
  setup to playing (second setup applied, or setup timeout), because
  only then is the trap/box layout known, so exclusions can be checked.
  The randomness source is injected: `Math.random` for local games,
  server-side random for online games, the battle runner's seeded rng
  for lab games (where replay exactness matters most — see §11).
- The placement is recorded in the game state and in log events, so
  replays reconstruct it exactly instead of re-rolling it.

**Placement rules.** One random tile:

- Land only — plains or forest, never water (a pickup on water could
  never be collected without a bridge).
- Rows 3–14 or 16–27: outside both sides' back 3 rows, and never the
  neutral row (y = 15). Goal rows are already excluded by the back-3
  rule.
- Never on a mystery-box tile, never on a trap tile, never under a
  placed piece.
- **No mirroring.** Either half is equally likely to hold the pickup,
  both players can reach anywhere, and some games nobody finds it.
  That ex ante symmetry is the fairness bar for a random event (contrast
  boxes, which are guaranteed and therefore mirrored).
- If no eligible tile exists (essentially impossible on a generated
  board), the game simply has no pickup rather than failing.

## 4. State

```ts
type PickupPowerKind = "trap" | "terraform";
interface Pickup {
  position: Position;
  kind: PickupPowerKind;
}
```

- `GameState.pickups`: uncollected pickups only. Collecting removes the
  entry.
- `GameState.heldPowers: Record<PlayerId, PickupPowerKind[]>`: powers a
  player currently holds. In practice at most one (there is only one
  pickup), but the array leaves room for more later.

## 5. Collection

Stepping onto the pickup tile collects it: the pickup leaves
`state.pickups`, its kind enters the collector's `heldPowers`, and the
step outcome carries `{ kind: "pickup", power }` for messages, sounds,
and logs.

Resolution order is a non-issue by construction: placement excludes
trap tiles, box tiles, and goal rows, so collection can never coincide
with a trap firing, a box roll, or scoring.

**Who learns what.** The collector is told the kind (they need to know
what they hold). The opponent is told nothing at collection time — in
online games the collection event goes to the collector's feed only.
(In hotseat both players share one screen, so the banner is visible to
both; accepted, same as any other shared-screen information.) The
opponent learns on use: terraform is visible on the shared board, while
a placed trap stays hidden until something steps on it, exactly like a
setup trap.

## 6. The trap power

`applyPickupTrap(state, player, target)`:

- Validation: phase playing, current player, holds `"trap"`, pool ≥
  `PICKUP_POWER_COST`, target has no active piece, no existing trap,
  no uncollected mystery box. Water is allowed (it fires only on a
  bridged entry); goal rows are allowed, like setup traps.
- Effect: `traps` gains `{ owner: player, position: target, triggered:
  false }`; `"trap"` leaves `heldPowers`; pool drops by the cost. Not
  movement; the turn continues.
- It **bypasses the 10-trap setup cap** — it is a bonus trap, not a
  setup trap.
- Because it is mechanically a `Trap`, everything else is inherited:
  sanitization hides it, trap sense reveals it, post-game reveal shows
  it, and it fires on entry (including bridged water entries) with the
  usual trap-before-scoring order.

For comparison with nerf: nerf removes an adjacent piece *now* for 1
token + 3 pool; the trap power removes a *future* piece that steps
there for 3 pool and no token. Delayed, anywhere, token-free.

## 7. The terraform power

`applyTerraform(state, player, target)`:

- Validation: phase playing, current player, holds `"terraform"`, pool
  ≥ `PICKUP_POWER_COST`, target terrain is water or forest. Plains is
  an invalid target (already cost 1 — nothing to change).
- Effect: `tiles[i].terrain` becomes `"plains"`; `"terraform"` leaves
  `heldPowers`; pool drops by the cost. Not movement; the turn
  continues. The change is **permanent** for the rest of the game.
- Deliberately allowed, because targeting is anywhere (your call):
  a trap, box, or piece on the tile is unaffected (the trap
  stays live, the box stays collectible, the piece stays put), and a
  goal-row water tile becoming plains becomes scoreable. The board's
  180° mirror breaks; that is cosmetic only, since pathing reads live
  tiles.
- A terrain mutation is not reconstructible from the seed, so it gets
  its own log event (§11).
- Edge case, legal and emergent: a bridged piece ending its turn on
  water drowns at `endTurn` — unless someone terraformed that tile to
  plains first, in which case the drowning check reads plains and the
  piece lives.

For comparison with bridge: bridge crosses one water tile for one
piece, once; terraform opens one tile for everyone, permanently. Hence
same-turn-only plus a pool cost.

## 8. Same-turn expiry and affordability

- `endTurn` clears the ending player's `heldPowers`, exactly like
  `bonusPoints` resets. A power never survives into a later turn.
- Using a power requires pool ≥ cost **at use time**. No partial use,
  no debt. Collecting with too few points left means the power expires
  unused at `endTurn` — the player's gamble, not an error.
- Costs: `PICKUP_POWER_COST = 3` for both powers (tuning knob, §14).

## 9. Hidden information and sanitization

- `sanitizeForPlayer` strips uncollected pickups from every view
  (`pickups: []`) and redacts held powers to the viewer's own, the way
  `revealedTraps` is redacted. The CPU deciding from a sanitized view
  therefore cannot route toward a pickup — it stumbles onto them like
  a human.
- The local page never renders pickups: Board only draws what it is
  handed, and pickups are never handed to it during play.
- Post-game, the finished screen lists any uncollected pickup
  (position + kind), the same reveal principle as traps. No board
  glyph: pickups were never drawn, so there is nothing to reveal
  visually.
- Trap sense does **not** reveal pickups. They are a separate system,
  not traps.

## 10. Interactions with existing rules

- Traps: placement excludes trap tiles; the trap power *is* a trap
  (see §6). A placed trap can cause attrition on entry exactly like
  any trap; placing one causes no immediate elimination, so no
  immediate attrition check.
- Mystery boxes: placement excludes box tiles; collection is separate
  from box collection (a tile holds at most one of box/pickup/trap by
  construction, except a trap power may be placed anywhere a box is
  not).
- Nerf: independent. Placing a trap costs no token and is not a nerf;
  terraforming is not movement.
- Bridge/drowning: see §7's edge case.
- Choke setup / CPU pathing: both read live tiles, so a terraformed
  tile is simply part of the graph from then on.

## 11. Network and replay

- Collection happens inside the existing move route (step outcome
  consequence, §5).
- Two new routes following the nerf route pattern (seat check, version
  check, events): `POST /api/games/[gameId]/pickup-trap` and
  `POST /api/games/[gameId]/pickup-terraform`.
- Log schema stays v1 (additive event types; old logs replay with
  `pickups: []`). But note the two logs are different things:
  - The **battle log** records `pickup_place` at the setup→playing
    transition (position, kind) — this is what keeps replays exact
    despite seed-independent placement — plus `pickup_collect` and
    `pickup_use` events.
  - The **player feed** (the per-game event log both seats poll) must
    NEVER carry placement or collection: a placement event would leak
    the pickup's position and kind to the opponent, and a collection
    event would tell them a power was found. So online collection and
    trap placement have no feed events at all — the acting player
    narrates from their action response. Terraform is the exception:
    the tile itself changes on the shared board, so `terraformed`
    (player, position) is a public feed event both seats narrate.
- The state route already serves sanitized views, so online pickups
  stay hidden with no new plumbing; the finished-game path already
  returns the full state, so the post-game recap can read it.

## 12. UI sketch (for the implementation PRs, no code here)

- Turn panel shows a held power while it lasts: `💣 Extra trap — place
  it this turn (3 pts)` / `🌍 Terraform — pick a water or forest tile
  this turn (3 pts)`.
- Targeting modes work like the nerf toggle, except there is no board
  highlight: with anywhere-targeting, highlighting every legal tile
  would light up most of the board. Clicking a tile attempts the use;
  illegal targets surface as messages, same as move/nerf errors.
- Collection banner (collector only online): `You found a pickup
  power: extra trap! Place it this turn.` If a turn ends with an unused
  power, a message notes it expired, so players learn the rule.
- Post-game recap line: `An unclaimed terraform pickup sat at (x, y).`
  (or nothing, when the pickup was claimed or no pickup spawned).

## 13. CPU hook

- The CPU cannot see pickups (sanitized view), so it finds them by
  luck, like a human. When it holds a power, it uses it before moving
  — but after the nerf: a certain elimination still outranks a
  speculative trap. The check runs every tick, so a power collected
  mid-turn is used on the next tick while the pool still covers it.
- Trap heuristic: place on a tile of the enemy best runner's current
  cheapest path, three steps ahead of the runner, scanning outward for
  the first legal tile and falling back to the nearest legal tile to
  the path. The enemy's path is predicted from a trap-blind view: the
  enemy does not know our hidden traps, so routing it around them (as
  the raw view would) predicts a detour it will never take. The
  opponent routes through hidden traps, so it fires; own pieces never
  trigger own traps, so the placement is never negative value — the
  CPU always uses a held trap power when it can afford it.
- Terraform heuristic: use only when it helps the CPU's own route
  (route-cost saving > 0), else let it expire — terraforming an enemy
  route tile would help the enemy, which is worse than nothing. The
  check compares the runner's real cheapest route against an optimistic
  one where water/forest cost 1, then verifies each water/forest tile
  on the optimistic path by recomputing the real route with just that
  tile terraformed; the biggest verified saving wins.
- Both shipped tiers (`full` and `hard`, now v5) share the same power
  use code: `choosePickupPowerAction`, checked after the nerf branch in
  both choosers. Hard bypasses lookahead for it — lookahead scores a
  hidden trap at ~zero, so as a candidate it would never win.
- Local page: a CPU trap placement is silent (no message, no sound —
  like a setup trap); a CPU terraform is narrated with the terraform
  sound, since the tile visibly changes. CPU collection stays
  unnarrated, as in phase 2.
- Battle lab: the strategies already share the use code, but lab games
  place no pickups yet (`createBattle` does not call `placePickup`),
  so tournaments are unaffected until the battle-log phase wires
  placement and log events together.

## 14. Test plan (for the implementation PRs)

- Placement: zone (rows, land, no neutral row), exclusions (box/trap
  tiles), timing (after setup, not in `createGame`), no-pickup fallback,
  kind distribution is 50/50 only in the statistical sense — tests pin
  the mechanism (injected rng), not the coin flip.
- Collection: removes pickup, grants held power, outcome consequence,
  collector-only narration.
- Trap power: full validation matrix (phase, turn, held, pool, occupied
  / trap / box targets, water and goal-row targets allowed); effect +
  cap bypass; fires on entry including bridged water; trap sense
  reveals; sanitize hides.
- Terraform: plains rejected, water/forest accepted, pool gate, effect
  permanent, piece/trap/box on tile unaffected, goal-row water becomes
  scoreable, mirror-break harmless.
- Expiry: `endTurn` clears the holder's powers; insufficient pool blocks
  use without erroring the game.
- Sanitization: pickups stripped, held powers viewer-only, finished
  state reveals all.
- CPU: holds power → uses before racing; bomb lands on enemy path;
  terraform only when beneficial.
- Replay: a log with pickup events reconstructs the game exactly,
  including a terrain mutation.
- Routes: seat/version checks, wrong-seat rejection, conflict retry.

## 15. Tuning knobs

- `PICKUP_POWER_COST = 3` (both powers).
- Placement zone rows (currently 3–14 and 16–27).
- Kind odds 50/50.
- Count: exactly 1 pickup per game (raising this is a balance change,
  not a bug fix).
