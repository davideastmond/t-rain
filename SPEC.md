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
- South's goal row is y 0; North's goal row is y 30. A piece that enters the goal row scores ("across") and is removed from the board. Exception (decided during Step 5 implementation): traps resolve on entry *before* scoring, so a piece that steps onto a trapped goal-row tile is eliminated and does not score.

## Terrain Generation
- Generated randomly at the start of every game; every game is unique.
- Generation is mirrored (180° rotational symmetry): both players face the same terrain, flipped. A purely random board could give one side open plains and the other a wall of water.
- Generation guarantees crossing routes, so Water can never seal the board. The precise check (implemented in Step 2): a flood fill from every passable tile on one back row must reach at least 3 tiles on the opposite back row. If a generated board fails the check, generation retries with the next draws from the same seeded random stream — the result is still fully determined by the seed.
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

## Mystery Boxes (see POWERUPS_SPEC.md)
- **2 per game** — one mirrored pair, one in each player's zone, generated with the board (passable tile, never in the back 3 rows, the neutral row, or a goal row). Public: both players see both boxes. No trap may be placed on a box tile.
- A box can only be collected by the player whose zone it is **not** in, by stepping onto its tile. For the home player it is inert. Each player can collect at most one box per game.
- Collection rolls the contents: **45% extra steps** (+2 free points for the collecting piece, this turn only, spent before pool points and exempt from the per-piece cap), **45% bridge** (the piece may cross one water tile at cost 1; it must reach land the same turn or it drowns, and a water tile never scores, even on the goal row), **10% booby trap** (the collecting piece is eliminated). The box is consumed on any outcome.

## Winning and Losing
- **First player to get 5 pieces across (onto the opponent's back row) wins.**
- A player loses immediately if their pieces still on the board + pieces already across drop below 5 — they can no longer reach the win target (e.g. 15 pieces, 0 across, 11 eliminated = 4 remaining, game over).
- A player with all pieces eliminated also loses (covered by the rule above).

## Tunable Numbers (expected to change with playtesting)
Movement pool 10 · per-piece cap 3 · 15 pieces · 5 to win · 10 traps · 3 neutral-trap cap · setup 120s · Forest ~15% · Water ~10%

## Graphics — Colored squares + biomes
- Direction (revised 2026-10-11, supersedes the earlier Minecraft-style texture idea, dropped for simplicity): tiles are colored squares; no textures or sprite sheets.
- The board's color scheme comes from a **biome**. Three biomes:
  1. **Grass / Forest**
  2. **Desert / Dry**
  3. **Ice**
- Biome scope DECIDED (2026-10-11): **one random biome per game, applied to the whole board** — both players see the same scheme, and each new match gets a new theme. The biome is chosen at game creation (it can be derived from the same game seed that generates the terrain layout, so one seed reproduces a whole match setup).
- Model:
  - A biome is a palette: a lookup table of terrain type → color. The engine's terrain types (Plains, Forest, Water) and all movement rules stay identical in every biome; only the colors (and flavor names) change. Example:

    | Terrain | Grass/Forest | Desert/Dry | Ice |
    |---|---|---|---|
    | Plains | light green | sand tan | snow white / pale blue |
    | Forest | deep green | dry olive-brown scrub | dark snowy pine teal-green |
    | Water | blue | blue (oasis) | deep ice blue |

  - Rendering is a DOM/CSS grid: one div per tile, `backgroundColor` from the active biome palette. Pieces, trap markers and move highlights are simple shapes/markers layered on the tile.
- **Pieces are 15 distinct cute characters** (decided 2026-10-11, superseding the numbered-marker idea): every piece has the same movement restrictions — characters are skins only and imply no abilities (the elephant is not stronger, the soldier does not fight, the alien does not teleport). Each player starts with one of each character — the same set on both sides — shown on a team-colored marker so ownership is the dominant signal and the character is the piece's identity ("North's elephant hit a trap"). The roster:
  cat 🐱, dog 🐶, horse 🐴, mouse 🐭, spider 🕷️, elephant 🐘, soldier 💂, alien 👽, fox 🦊, bear 🐻, rabbit 🐰, frog 🐸, pig 🐷, owl 🦉, penguin 🐧.
  In the data model a piece has a `character` from this roster (unique per player), and its id can be derived as e.g. `"north-cat"`. The roster lives in one table (character → display name, emoji) that rendering reads; the engine never branches on character.
  - A later option (not v1) is letting the biome also tweak generation mix (e.g. less water in Desert); v1 keeps percentages identical across biomes so balance doesn't change with the skin.

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
