# T-rain suggestions

Proposed ideas, not decisions. Each entry notes where it came from and
what's still open. An idea graduates to SPEC.md (or its own spec) only
when it's accepted — never edit the rulebook from here.

## Bonus pickups (proposed 2026-10-19)

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
