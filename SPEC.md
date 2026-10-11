# T-rain — V1 Rulebook

**T-rain** (a pun on "terrain") — ideation spec, 2026-10-11. Repo: https://github.com/davideastmond/t-rain

_No code yet. All rules below are DECIDED / CONFIRMED as of 2026-10-11. Terrain mix percentages are tunable starting values._

## Overview
A 2-player, turn-based race across a randomly generated board. Read the terrain, place your pieces and hidden traps under time pressure, then spend a shared movement pool each turn to get 5 of your 15 pieces to the far end — before hidden traps thin your army below the number you need to win.

## Board
- 30 tiles wide (x 0–29) × 31 tiles high (y 0–30) = 930 tiles.
- North zone: y 0–14 (15 rows, 450 tiles).
- Neutral row: y 15 (1 row, 30 tiles).
- South zone: y 16–30 (15 rows, 450 tiles).
- South's goal row is y 0; North's goal row is y 30. A piece that enters the goal row scores ("across") and is removed from the board.

## Terrain Generation
- Generated randomly at the start of every game; every game is unique.
- Generation is mirrored (180° rotational symmetry): both players face the same terrain, flipped. A purely random board could give one side open plains and the other a wall of water.
- Generation guarantees at least a few fully passable routes across the board, so Water can never seal it.
- Terrain types for v1 (designed as an expandable table: type → movement cost, passable?):

  | Type | Cost to enter | Passable | Share (tunable) |
  |---|---|---|---|
  | Plains (default) | 1 | Yes | ~75% |
  | Forest | 2 | Yes | ~15% |
  | Water | — | No | ~10% |

- More types (hills, mud, etc.) can be added later as new rows in that table, with no rule changes elsewhere.

## Setup Phase
- Both players set up simultaneously, against a 120-second timer for the combined phase.
- Each player places:
  - **15 pieces** in their own back 3 rows only (North: y 0–2; South: y 28–30). Not on Water.
  - **10 traps** in their own zone + the neutral row, with **at most 3 traps in the neutral row**.
- Traps are invisible to the opponent. Your own traps are always visible to you and never harm your own pieces.
- Both players' traps may occupy the same neutral tile; each trap only affects its owner's opponent.
- Traps cannot be placed on Water (no piece can enter Water anyway).
- If the timer expires with placements unfinished, remaining pieces/traps are auto-placed on random valid tiles.
- Setup ends when both players confirm Ready or the timer expires.

## Movement
- The first player is decided randomly. No compensation for moving second in v1.
- Players alternate turns.
- On your turn you have a **shared pool of 10 movement points** to split across any of your pieces, moving step by step, tile by tile.
- Movement is **4-direction only**: up, down, left, right. No diagonals.
- Entering a Plains tile costs 1 point; entering a Forest tile costs 2 points; Water cannot be entered.
- At most 3 points may be spent on any one piece per turn (spending the full pool therefore requires moving at least 4 pieces).
- Unspent points do not carry over — no banking for a later burst.
- **Occupancy:** No stacking and no capturing by movement — a tile occupied by any piece (yours or the opponent's) cannot be entered. Pieces therefore block routes, and a goal-row tile occupied by a defending piece cannot be scored on until it moves. Only traps eliminate pieces.

## Traps in Play
- **Every tile a piece enters triggers a trap check** — not just the tile where the piece stops moving.
- If the entered tile holds an opponent's trap: the piece is eliminated, the trap is consumed (single-use), and the trap tile is revealed to both players.
- A piece that survives entering a tile proves that tile is safe for later pieces.
- Your own traps never trigger on your own pieces.

## Winning and Losing
- **First player to get 5 pieces across (onto the opponent's back row) wins.**
- A player loses immediately if their pieces still on the board + pieces already across drop below 5 — they can no longer reach the win target (e.g. 15 pieces, 0 across, 11 eliminated = 4 remaining, game over).
- A player with all pieces eliminated also loses (covered by the rule above).

## Tunable Numbers (expected to change with playtesting)
Movement pool 10 · per-piece cap 3 · 15 pieces · 5 to win · 10 traps · 3 neutral-trap cap · setup 120s · Forest ~15% · Water ~10%

## Build Implication (not yet greenlit)
Hidden traps make the game hidden-information: a same-screen hotseat mode needs a pass-the-device handoff with the board hidden between setups/turns, and any online mode must be server-authoritative — the server must never send the opponent's untriggered trap locations to a client. A vs-CPU mode avoids the secrecy problem entirely and is the natural first playable for playtesting the numbers above.

## Transport — RECOMMENDED: HTTP + polling (not yet confirmed by user)
Terrain is strictly turn-based: game state only changes on the active player's actions, and the simultaneous setup phase has no interaction between players until both submit. Nothing needs sub-second latency, so WebSockets buy nothing in v1 — and Next.js on serverless hosting does not run a persistent WebSocket server natively (it would need a separate service such as Pusher/Ably or a custom server).

Recommended design, the same pattern proven in tmatrix PvP/chat:
- Server-authoritative state (e.g. MongoDB), with a per-player filtered view: a client's state response contains only its own untriggered traps.
- A monotonically increasing `version` on the game state. Waiting clients poll `GET state` every ~2s with their last version; the server returns a light "unchanged" response or the new filtered state.
- Moves are submitted step by step: one `POST` per tile entered (max ~10 per turn). The server validates cost, per-piece cap, occupancy and Water, resolves the trap check, and returns the result — so a trap revealed mid-turn can change the rest of that turn's plan, and no move rule is ever trusted to the client.
- An explicit `POST end-turn`. Setup is a single validated `POST` per player (piece/trap counts, zones, neutral cap, Water checks server-side).
- Timers (setup countdown) are server timestamps (`setupEndsAt`); clients count down locally and poll for phase changes.
- If real-time features are ever wanted (spectators, instant chat), the transport can be swapped for SSE or a hosted WebSocket service later without changing the engine or the versioned-state API.
