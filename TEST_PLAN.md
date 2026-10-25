# T-rain test plan

Status: draft. This plan introduces automated testing to a project that
currently verifies by `tsc` + ESLint + `next build`, ad-hoc Node harnesses
compiled to `/tmp`, and hands-on playtesting. Nothing in this plan replaces
playtesting for feel, layout, and sound — it replaces the harnesses and
locks the game rules in place so refactors stop being scary.

## 0. Stack and configuration

- **Runner: Vitest.** Fast, handles TypeScript natively, and needs no Next
  plugin for this codebase: nothing under `src/lib`, `src/components`, or
  `src/app/api` imports from `next/*`, so engine, net, route, and component
  code all import cleanly into Vitest with no Next mocking.
- **Components: `@testing-library/react` v16** (the React 19 release),
  `jsdom`, `@testing-library/user-event`, `@testing-library/jest-dom`.
- **Config: `vitest.config.ts`** at the repo root:
  - `resolve.alias`: `{ "@": "<root>/src" }` (mirrors `tsconfig.json` paths).
  - Default environment `node`. Component tests opt into jsdom per file
    with a `// @vitest-environment jsdom` comment — most of the suite is
    pure logic and should not pay jsdom startup.
  - `include`: `src/**/*.test.{ts,tsx}`. Tests live next to the code they
    cover, not in a separate `__tests__` tree.
- **Scripts** (added to `package.json`):
  - `test`: `vitest run` (CI, single pass, fails on failure).
  - `test:watch`: `vitest` (local development).
- **Dev dependencies:** `vitest`, `@testing-library/react`,
  `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`.
  No `mongodb-memory-server` (see Phase 2), no Playwright (see §6).

## Conventions

- **Fixed seeds, no randomness in tests.** Board generation, box placement,
  and box rolls are all seeded (`generateBoard(seed)`,
  `generateMysteryBoxes(seed, tiles)`, roll stream `seed + 404 + boxRolls`).
  Tests pin seeds and assert exact outcomes — the same determinism the
  battle lab already relies on.
- **Build states with the real constructors.** Prefer `createGame(seed)` +
  `applySetup` / `autoPlaceSetup` over hand-assembled `GameState` objects,
  so tests break when the state shape changes instead of silently testing
  a shape the game never produces. Hand-built states are acceptable only
  for positions the constructors cannot reach (e.g. a piece already on the
  goal row mid-turn).
- **One behavior per test, named after the rule.** E.g.
  `movePieceStep: trap on the goal row resolves before scoring`, not
  `movement works`.
- **No coverage percentage gate to start.** The gate is the rules checklist
  in Phases 1–3: every locked rule in `SPEC.md`, `NERF_SPEC.md`, and
  `POWERUPS_SPEC.md` gets at least one test. A percentage target can come
  later, once the suite exists.

## Phase 1 — Engine unit tests (do this first)

Highest value, zero mocking, all pure functions. One PR per module group
is fine; the order below is value order.

### 1a. `movement.ts` — the core loop

- Pool and caps: 10 shared points per turn; max 3 per piece per turn;
  points do not carry across turns (`endTurn` resets).
- Orthogonal-only steps; occupied tiles block; `legalStepTargets` and
  `canStep` agree (every target `canStep` approves, every approved step
  appears as a target).
- Terrain costs: plains 1, forest 2, water impassable without a bridge.
- Trap timing: a trap fires the instant a piece enters the tile, mid-turn;
  a trap on the goal row resolves **before** scoring, so a trapped piece
  never scores.
- Mystery-box resolution order inside a step: movement cost → trap →
  mystery box → (trap sense) → scoring → win/loss.
- Scoring: entering the opponent's goal row scores; first to 5 wins;
  a water tile never scores, even on the goal row.
- Drowning: a piece ending its turn on water (bridge consumed) is
  eliminated (`findDrownedPiece`); drowning counts toward attrition.
- Attrition: when active + scored drops below 5, the player loses
  immediately (not at end of turn).

### 1b. `boxes.ts` — mystery boxes

- Placement: exactly 2 per game, one mirrored pair, one in each player's
  zone, never on the goal row, never on a trap tile (see `setup.ts` too).
- Collection is invader-only: the box owner's own pieces cannot collect.
- Roll determinism: same seed + same roll count → same outcome; the
  threshold chain yields the documented odds (40% extra steps / 25%
  bridge / 25% trap sense / 10% booby) — test via the thresholds, not by
  sampling (sampling a seeded stream is a tautology; asserting the
  boundaries is the real check).
- Extra steps: +2 free points, collecting piece only, this turn only,
  above the per-piece cap, spent before pool points.
- Bridge: held by the piece; entering water costs 1 and consumes it;
  exactly one water tile per bridge.
- Booby trap: the collector is eliminated.
- Trap sense: on collection and after each step the sensing piece takes
  that turn, the 4 orthogonal neighbours are checked (`senseAdjacentTraps`);
  reveals are permanent but owner-only (see §2c); sensing ends when the
  piece is eliminated or scores; `endTurn` clears all `hasTrapSense`.

### 1c. `nerf.ts` — nerf tokens

- Scoring earns 1 token into pending; cap 2 across usable + pending;
  pending flips to usable at the scorer's `endTurn` (not immediately).
- Cost: 1 usable token + 3 pool points; `canNerf` rejects otherwise.
- Targeting: `nerfTargets` returns exactly the active enemy pieces
  orthogonally adjacent to any of the spender's active pieces.
- Effect: the target is eliminated; multiple nerfs per turn are allowed
  while tokens and pool last.

### 1d. `board.ts`, `rng.ts`, `setup.ts` — generation and setup

- Mirroring: `mirrorPosition` is an involution (mirroring twice returns
  the original) and generation is 180°-mirrored; same seed → identical
  board, boxes, and biome.
- Passability: land flood fill reaches ≥ 3 opposite back-row entries
  (`crossingEntryCount` ≥ `MIN_CROSSING_ENTRIES`).
- Setup validity: `canPlacePieceAt` / `canPlaceTrapAt` enforce 15 pieces
  in the own back 3 rows, 10 traps in the own zone + neutral row, max 3
  neutral, never on water, never on a mystery-box tile.
- `autoPlaceSetup` always produces a valid setup (the 120 s network
  clock depends on it).

### 1e. `cpu.ts` and `battle/` — pathfinding and strategy smoke tests

- `findPath` / `findPathToGoal`: Dijkstra costs match terrain (plains 1,
  forest 2, water blocked without a bridge); revealed opponent traps are
  in the blocked set; a path to an unreachable goal is reported as such.
- `isSpoilerMode`: true exactly when the opponent needs 1 and the CPU
  needs 2+.
- `chooseCpuAction` priority: nerf → hunt → spoiler → race (no dedicated
  blocking step exists — do not test for one).
- Battle lab: `runBattleGame` with fixed seeds terminates (five-across,
  attrition, or turn cap) and reports a valid winner; `parseJSONL`
  round-trips a recorded log. **Do not assert strategy win rates**
  (e.g. full-vs-pathfinder percentages) — those are lab measurements,
  not contracts, and pinning them would freeze tuning.

## Phase 2 — Net library and API route tests

No database, no server. `getGameStore()` returns an `InMemoryGameStore`
when `MONGODB_URI` is unset, which is exactly the test configuration.

### 2a. `net/` library

- `createNetGame` / `gameLink`: a created game has two seats, two tokens,
  and links that carry the right seat's token; `BASE_URL` unset still
  throws from `gameLink` (existing behavior — pin it).
- `authenticateGameRequest`: valid token → seat; missing/unknown token →
  403; a token for the wrong game → 403.
- `sanitizeForNetPlayer` / `sanitizeForPlayer`: the viewer sees their own
  traps, triggered traps, and their own revealed traps — never the
  opponent's unrevealed traps or revealed set (the privacy rule that
  makes trap sense work online).
- `appendEvent`: events append in order, capped at `MAX_EVENTS` (50);
  `maybeAutoPlaceSetup` fires exactly on setup-clock expiry.
- **Test-isolation note:** `getGameStore()` caches one module-level
  in-memory store. Lib tests should construct `new InMemoryGameStore()`
  directly. Route tests share the cached store, so they must use a fresh
  game (fresh `createNetGame`) per test rather than assuming an empty
  store — or this plan's Phase 2 PR adds a small test-only reset. Prefer
  fresh games; a reset hook is a last resort, not the default.

### 2b. Route handlers (imported directly, no HTTP server)

Each handler in `src/app/api/games/route.ts` and
`src/app/api/games/[gameId]/{state,setup,step,end-turn,nerf,forfeit}/route.ts`
is an exported `GET`/`POST` taking `(request, { params })`, where params
is a `Promise` in Next 16. Tests call them with `new Request(url, …)`
and `{ params: Promise.resolve({ gameId }) }`, exactly as the client
would, minus the network:

- `POST /api/games`: creates a game, returns both seat links/tokens.
- `GET state`: returns the viewer's sanitized state + events after
  `lastEventSeq`; unauthenticated → 403.
- `POST setup`: validates placement (same rules as §1d), starts the
  120 s clock on North's first authenticated request, auto-places on
  expiry.
- `POST step`: one tile per call; validates cost, cap, occupancy, water;
  resolves trap/box/score server-side; wrong phase → 403; not your turn
  → 403; bad body → 400 (via `errorStatus`).
- `POST end-turn`: flips the turn, flips pending nerf tokens to usable,
  clears trap sense, drowns stranded pieces.
- `POST nerf`: validates token + pool + adjacency server-side.
- `POST forfeit`: ends the game for the forfeiting seat.
- A full happy-path game through the handlers (create → setup → steps →
  score 5 → game-finished) as one integration test, asserting the event
  log narrates each step.

**Deliberately not covered here:** `mongo.ts` itself (needs a real
MongoDB; the `GameStore` interface is the seam, and the in-memory
implementation is what tests exercise) and real HTTP transport (headers,
compression, the 32 KB polling quirk) — that layer is the deployed
site's, verified by playtesting.

## Phase 3 — Component and sound tests (jsdom)

Thin by design: components render engine state, they do not re-implement
it. Do not re-test movement/nerf/box rules through the UI.

### 3a. `Board.tsx`

- Renders tiles, pieces, traps, and uncollected mystery boxes from props;
  own traps vs revealed traps get different titles (the "still live"
  distinction for trap sense).
- `selectedKey` draws the selection ring; `dangerHighlighted` outlines
  nerf targets in red.
- Clicking a tile calls `onTileClick` with that tile's position
  (user-event); no handler → no crash.

### 3b. `SetupTray.tsx`

- Shows draft piece count, trap count, and neutral trap count from props;
  selecting a character calls `onSelectCharacter`; mode toggle calls
  `onModeChange`.

### 3c. `sound.ts` (no real audio)

- `soundForStepOutcome` priority: trap > box > scored > move (the
  existing ad-hoc harness covered 6 cases — formalize them).
- `netEventSounds`: one sound per step (steps covered by a terminal
  event in the same batch are skipped); step → move, trap → trap,
  scored → score, nerfed → nerf, box → box (booby → trap), drowned →
  drown; opponent turn-ended → the two-tone turn sound; game-finished →
  win/lose at 300 ms delay; volume rule: full for your pieces, ×0.6
  (`soft`) for the opponent's; getting nerfed is full, nerfing is soft;
  game-created / player-joined / setup-submitted / forfeited are silent.
  Null seat → no sounds. (The existing harness covered 16 cases —
  formalize them.)
- `playSound` itself is not unit-tested for output (Web Audio in jsdom
  is a stub at best); assert only that it no-ops safely without a
  context and respects the mute flag. `isMuted`/`setMuted` persist via
  `localStorage` key `train-muted` (jsdom provides `localStorage`).

## Phase 4 — CI and retiring the harnesses

- GitHub Actions workflow (`.github/workflows/test.yml`): on push and
  pull request — checkout, `npm ci`, `npm test`, `npm run lint`,
  `npm run build`.
- **Prerequisite, flagged now:** `npm ci` currently fails at dev head
  because `package.json` and the lockfile are out of sync (pre-existing;
  local work uses `npm install` and reverts lockfile changes). The CI
  PR must sync them first, or CI cannot run at all.
- Once Phase 1 lands, delete the ad-hoc `/tmp` harness pattern from the
  workflow: the vitest suite is the harness now. Keep the battle lab
  (`src/lib/battle/`) as a lab tool, not a test — its job is measurement,
  and §1e covers only its smoke behavior.
- Playtesting stays: layout (including the `min-w-[760px]` board floor
  on phones), sound timbre/volume, and anything involving a real
  browser or a real opponent are not automatable in this stack and are
  not pretended to be.

## Rollout (one PR per step, in this order)

1. Phase 0: deps + `vitest.config.ts` + scripts + one smoke test
   (e.g. `createSeededRng` determinism) proving the runner works.
2. Phase 1a–1b: movement + boxes.
3. Phase 1c–1d: nerf + generation/setup.
4. Phase 1e: CPU pathfinding + battle smoke tests.
5. Phase 2a: net library.
6. Phase 2b: route handlers + the happy-path game test.
7. Phase 3: components + sound mappings.
8. Phase 4: lockfile sync + CI workflow + harness retirement.

Each PR: suite green (`npm test`), `tsc` clean, ESLint clean, and the
new tests actually run in CI once Phase 4 exists (before that, run
locally and say so in the PR body).

## 6. Explicit non-goals

- Playwright / browser E2E. The browser cannot reach the local dev
  server from automation, and hands-on playtesting covers this layer.
- `mongodb-memory-server` or a live test database. The `GameStore`
  interface plus the in-memory implementation is the tested seam.
- Visual snapshot tests of the board. Tile layout is checked by eye;
  snapshots would churn on every palette tweak.
- Coverage percentages as a merge gate. Rules coverage (Phases 1–3
  checklists) is the gate; percentages follow later if useful.
