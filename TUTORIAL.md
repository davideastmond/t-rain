# Tutorial sketch

How a new player learns T-rain. Proposal, not a build plan — the shape
below is a starting point to react to.

## Goal

Teach the full game in ~5 minutes, interactively, before the first real
game. A player who finishes the tutorial should know: the win condition,
setup, movement economy, terrain, traps, scoring, attrition, and nerfs.

## Recommended approach: guided interactive tutorial

A scripted scenario on the local board with a fixed seed (deterministic,
replayable). A coach line explains each step; the player does it:

1. **Setup** — place 3 pieces and 2 traps with guidance (back 3 rows for
   pieces; traps in own zone + neutral row, max 3 neutral). Auto-place
   the rest. Teaches: hidden setup, 120s clock exists (not enforced here).
2. **Movement** — move a piece 3 tiles. Teaches: shared 10-point pool,
   per-piece cap of 3, orthogonal only, occupied tiles block.
3. **Terrain** — route one piece through forest (cost 2) and around water
   (impassable). Teaches: reading tile costs.
4. **Traps** — walk onto a scripted enemy trap. Piece eliminated, trap
   spent and revealed. Teaches: traps fire on entry (mid-turn), single
   use, turn continues.
5. **Scoring** — cross the goal row. Teaches: first to 5 wins, crossing
   earns a nerf token (usable *next* turn).
6. **Nerf** — arm the toggle, red targets, eliminate an adjacent enemy
   piece. Teaches: 1 token + 3 pool, adjacency requirement.
7. **Attrition** — explain, don't demo (or a tiny scripted demo):
   dropping below 5 able-to-score ends the game immediately.
8. Done → "Play vs CPU" button.

## Alternatives considered

- **Static how-to-play page**: cheaper to build, but nobody reads it.
  Keep as a fallback reference, not the primary teacher.
- **Contextual hints during the first real game**: nice, but harder to
  scope and easy to get annoying. Maybe later, informed by where
  tutorial graduates still stumble.

## Implementation notes

- Reuse the local game: `Board` (highlight props already exist),
  the engine, and the message feed for coach lines.
- A small `tutorial.ts` driver: scripted stages, each waiting for the
  player to perform the right action before advancing; a "show me"
  button auto-plays the step for the impatient.
- Fixed seed + scripted trap/enemy layout so every run teaches the
  same beats.
- Skippable, replayable from the landing page; optionally auto-prompt
  on first visit (localStorage flag).
- Out of scope: online play (invite links, polling, presence) — teach
  local first. No opponent decisions needed; the "enemy" is scripted.

## Open questions

- Coach voice: text-only v1, or a character?
- How much to script vs. free play with guardrails?
- Demo attrition interactively, or is explaining enough?
- Where does it live: landing-page card, first-visit prompt, or both?
