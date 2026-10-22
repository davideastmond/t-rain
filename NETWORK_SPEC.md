# T-rain — Human vs Human network play (spec, v1)

Status: **spec only — no code.** This document turns the HTTP + polling
transport already recommended in SPEC.md into a buildable design. Game
rules are unchanged (SPEC.md is normative for rules); the nerf mechanic
is explicitly out of scope here and sequenced after network play works.

## 1. Goals

- Two humans play a full game of T-rain from two browsers, each seeing
  only what they should: their own untriggered traps stay secret.
- The server is authoritative. No game rule is ever trusted to the
  client — the existing engine (`setup.ts`, `movement.ts`, `board.ts`,
  `rng.ts`) is pure and transport-agnostic, so the server imports and
  runs it directly for validation.
- Reuse as much of the local game as possible: the `Board` component,
  palettes, and the setup/play UI patterns carry over; only the state
  source changes (poll loop instead of `useState`).

## 2. Non-goals (v1)

Accounts, matchmaking / public lobby lists, spectators, chat, turn
timers beyond setup, rematch-as-server-flow (a rematch is just a new
game), and mobile-app clients.

## 3. Architecture

- **Next.js Route Handlers** (`src/app/api/...`) form the game server,
  deployed with the app (Vercel). No WebSockets: the game is strictly
  turn-based, state only changes on a player's action, and nothing
  needs sub-second latency.
- **Persistence** behind a small `GameStore` interface with atomic
  compare-and-swap on write:

  ```
  load(gameId) -> GameRecord | null
  save(record, expectedVersion) -> ok | version-conflict
  ```

  Recommended v1 backend: MongoDB (the pattern already proven by
  tmatrix PvP), in-memory implementation for local dev and tests.
  The exact backend is an open decision (see §14); the interface is
  what matters.
- A **game record** holds: `gameId`, the full authoritative
  `GameState` (including *both* players' untriggered traps — never
  leaves the server unfiltered), `version` (monotonically increasing
  integer, bumped on every mutation), a capped **event log**
  (last ~50 entries), per-seat `lastSeenAt` timestamps, `setupEndsAt`,
  and seat tokens (hashed at rest).

## 4. Seats, tokens, joining

- A game has exactly two **seats**: South (creator) and North
  (joiner). Seat assignment is fixed at join time; the *first player*
  is still drawn randomly from the seed by `createGame`, as today.
- Each seat gets a secret **token** (256-bit, hex). The token is a
  bearer credential: `gameId` alone grants nothing. All requests
  carry it (query param or header).
- Joining is by **link**: each seat has its own URL,
  `/game/[gameId]?t=[token]`. The creator copies the opponent's link
  to share it (chat, text, etc.). No join codes in v1 (open decision,
  §14).
- Reloading the link **reconnects** — all state lives server-side,
  so the client rebuilds purely from `GET state`.

## 5. Phases and lifecycle

`lobby` → `setup` → `playing` → `finished`.

- **lobby**: game created, waiting for North to open their link
  (first authenticated request with North's token flips to `setup`
  and starts the setup clock).
- **setup**: both players submit placements **simultaneously** via
  one validated POST each (no draft sync — nothing leaks early).
  Server validates with the existing setup engine (counts, zones,
  neutral-row cap, water). `setupEndsAt` is a server timestamp
  (~120s, per the existing rule); on expiry the server auto-places
  for whoever hasn't submitted (`autoPlaceSetup`). Phase flips to
  `playing` when both seats have applied.
- **playing**: turn-based exactly per SPEC.md. Only the current
  player's token may mutate.
- **finished**: `winner` set by the engine, as today.

## 6. HTTP API

All responses are JSON. Mutations are token-authenticated; a token
for the wrong seat, or any mutation out of phase/turn, returns
`403` with the engine's error code where one exists
(`not-your-turn`, `wrong-phase`, …).

- `POST /api/games`
  Create. Body: `{}`. Response:
  `{ gameId, yourSeat: "south", yourLink, inviteLink, version }`.
  The server runs `createGame(randomSeed)` — board, biome, and
  first-player draw happen here, once.
- `GET /api/games/[gameId]/state?t=[token]&version=[N]&lastEventSeq=[M]`
  Poll. If `N` equals the server version: `{ changed: false }`
  (light response). Otherwise: `{ changed: true, version,
  state: <filtered view>, events: [...] }`. Clients poll every ~2s.
- `POST /api/games/[gameId]/setup?t=[token]`
  Body: `{ pieces: [{ character, x, y } × 15], traps: [{ x, y } × 10] }`.
  Validated by the setup engine; on success applies and returns the
  filtered state. Reusing `SetupError` codes on failure.
- `POST /api/games/[gameId]/step?t=[token]`
  Body: `{ pieceId, to: { x, y } }`. The server runs
  `canStep`/`movePieceStep` on the authoritative state — one POST
  per tile entered, exactly like the local game — and returns
  `{ ok: true, state: <filtered>, outcome }`, reusing `MoveError`
  codes on failure. A trap revealed mid-turn is visible in the
  returned state, so the client can replan the rest of the turn.
- `POST /api/games/[gameId]/end-turn?t=[token]`
  Runs `endTurn`; returns the filtered state.
- `POST /api/games/[gameId]/forfeit?t=[token]`
  Resign: phase → `finished`, winner = the other seat.

Writes use compare-and-swap on `version`: a mutation reads the
record, applies the pure engine function, and saves with
`expectedVersion`; on conflict it retries once. Two rapid step
POSTs can never silently clobber each other.

## 7. Filtered views and hidden information

- Every state sent to a client passes through
  `sanitizeForPlayer(state, player)` — the exact function already
  built for the CPU opponent. A client **never** receives the
  opponent's untriggered trap locations. Triggered traps are public
  and included.
- **Trap sense (POWERUPS_SPEC v2 §6)** is the one exception, and it is
  per-viewer: traps a player has revealed with trap sense are included
  in *that player's* filtered state (they sit in the traps list like
  their own), and the state's `revealedTraps` is redacted to the
  viewer's own list. The opponent's copy contains neither the revealed
  positions nor any trace of what has been learned. The step response
  to the mover carries their own step `outcome` (including its
  `revealed` positions) — that response only ever goes to the mover.
- The **event log** is the client's narration/animation feed:
  `step { pieceId, from, to, cost }`, `trap-triggered { at,
  victimPieceId }`, `scored { pieceId, player, scores }`,
  `turn-ended { player }`, `setup-submitted { player }`,
  `game-finished { winner, reason }`, `forfeited { player }`,
  `box-collected { player, pieceId, outcome }`,
  `piece-drowned { player, pieceId }`.
  Entries are appended server-side on every mutation, each with a
  `seq`. Clients send `lastEventSeq` and receive only newer entries.
  Trap events reference only *triggered* traps, so the log leaks
  nothing either. `box-collected`'s outcome includes `trap-sense`
  (v2) — the roll itself is public — but there is deliberately **no
  trap-revealed event**: a revealed position in the shared log would
  leak it to the opponent. The collecting client derives its own
  reveal narration from the growth of its filtered `revealedTraps`.

## 8. Setup protocol (detail)

- Each seat POSTs its full placement once. The server validates the
  whole submission through `canPlacePieceAt` / `canPlaceTrapAt`
  (same error codes the local UI already renders) and applies it
  via `applySetup`. Partial/invalid submissions are rejected
  wholesale — the client keeps its draft and shows the reason.
- A seat that already submitted cannot resubmit.
- At `setupEndsAt`, the server auto-places for any missing seat and
  advances the phase. Clients count down from the server timestamp
  locally and learn the phase change via polling.

## 9. Play protocol (detail)

- The active player's client enables piece selection; legal targets
  are computed client-side from the filtered state with the
  existing `legalStepTargets` (same code as local play — the view
  contains everything it needs), then each step is POSTed and the
  server re-validates authoritatively.
- The waiting player's client polls and renders; selection UI is
  disabled on their side.
- `movementPointsLeft`, `spentThisTurn`, and scores all live
  server-side. The client never computes them.

## 10. Presence, timeouts, forfeit

- Every authenticated request refreshes that seat's `lastSeenAt`;
  `GET state` includes `opponentSeenAgoSec` so the client can show
  "opponent online / away".
- **Setup** has the 120s server clock (existing rule).
- **Play has no turn timer in v1** (open decision, §14). A stuck
  game is resolved by the forfeit button; a player who closes the
  tab simply stops polling, and the opponent sees them go "away".

## 11. Security notes

- Seat tokens are bearer secrets (share links work like shared
  secrets — acceptable for friendly v1 play, not for ranked).
- Game logic runs only on the server, on the canonical engine
  modules. The client is a renderer + input device.
- Basic rate limiting on the API routes (poll cadence is
  client-driven at ~2s; the server may answer `429` with
  `retry-after`).

## 12. Client shape (no code in this PR)

- `/` gains "Create online game" (and keeps local hotseat/CPU).
  After creation it shows the invite link to copy.
- `/game/[gameId]` reads the token from the URL, polls `GET
  state`, and reuses `Board`, the setup screen, and the turn UI —
  with `useState(game)` replaced by the poll loop and actions
  replaced by POSTs. Optimistic step animation is explicitly
  *not* in v1: the client waits for the server's response (2s
  poll + one round trip keeps it feeling instant for a
  turn-based game).

## 13. Test plan (for the implementation PRs)

- Engine reuse: existing movement/setup harnesses already cover
  rule validation; the API layer needs tests that a second,
  malicious client cannot move out of turn, see hidden traps,
  submit invalid placements, or double-submit setup.
- Poll contract: version-unchanged returns light; events replay
  from `lastEventSeq` without leaking trap positions.
- CAS: two concurrent steps don't lose updates.
- Reconnect: new client with a seat token rebuilds full UI state
  from one `GET state`.

## 14. Open decisions (flagged, not blocking the spec)

1. **Persistence backend**: MongoDB (tmatrix precedent) vs.
   alternatives. The `GameStore` interface isolates the choice.
2. **Join codes**: short human-typable codes in addition to links.
3. **Play-phase timers**: chess-clock-per-turn vs. none (v1: none).
4. **Poll interval**: 2s default; tune after playtesting.
5. **Rematch flow**: v1 = "create a new game and share a new
   link"; a server-side rematch endpoint is deferred.
