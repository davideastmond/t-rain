# T-rain suggestions

Proposed ideas, not decisions. Each entry notes where it came from and
what's still open. An idea graduates to SPEC.md (or its own spec) only
when it's accepted — never edit the rulebook from here.

## Bonus pickups (proposed 2026-10-19)

**Graduated 2026-10-20 → `POWERUPS_SPEC.md`** ("mystery boxes": mirrored
pair, invader-only collection, 45/45/10 mystery roll). The original
proposal is kept below for the record.

Source: suggested by a human opponent after a network PvP game.

Randomly generated pickups on the map:

- **Extra movement** — grants bonus movement points (e.g. +2 pool points
  the turn it's collected).
- **Bridge** — lets a piece cross a water tile (single use?).

Open design questions:

- Spawn: how many per game, and where? Mirrored placement for fairness
  (like terrain generation)? Never on water, or in the back rows?
- Visibility: seen by both players, or hidden like traps?
- Collection: stepping onto the tile collects it? Can a pickup share a
  tile with a trap or a piece?
- Timing: all placed at game start, or respawning during play?
- Balance: extra randomness favors someone — does mirrored placement
  fully fix that, or do pickups need to be symmetric in effect too?

## Terrain boxing (observed 2026-10-19)

Not a proposal — an observation from the same PvP game: a human player
used terrain (water/forest) to box in the opponent's pieces and stall
their advance. Worth remembering when tuning the CPU: positional
blocking is a real human tactic, even though we decided it's a bad trade
for the CPU (see `CPU_STRATEGY.md`, spoiler mode — disruption only when
the race is already lost).

## CPU Detects safe paths (proposed 2026-10-19)

Source: observed in network PvP game, suggested as a potential CPU improvement.

Idea: the CPU should identify paths that avoid enemy threats and terrain hazards, allowing it to move pieces more safely and strategically.

Open design questions:

- Detection: how far ahead should the CPU look to determine a safe path?
- Trade-offs: should the CPU prioritize safety over speed or aggression?
- Integration: how does this interact with existing CPU strategies, like disruption or opportunistic attacks?

Assessment (2026-10-19): mostly already covered or unknowable —

- Terrain hazards are already handled: the Dijkstra router treats water
  as impassable and prefers plains over forest by cost. Nothing safer to
  compute there.
- Hidden traps can't be routed around by anyone — they're invisible by
  design. The only real defense is the existing tiebreak: fewer steps =
  fewer trap rolls. Any "safety score" beyond that would be fake precision.
- The one genuine gap is nerf avoidance (enemy pieces are visible), but
  detouring around a *possible* nerf means more steps, i.e. more trap
  rolls against 10 hidden traps — trading a maybe for a definitely.
- Before building this: get battle-lab data showing nerfs are actually
  what's killing CPU pieces. If anything, it'd be a small tiebreak weight
  (prefer end tiles not adjacent to enemy pieces when the enemy holds a
  token), not a separate pathfinder.
