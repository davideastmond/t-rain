# Battle lab

CPU-vs-CPU battles with full logging, for tuning the algo with data instead
of vibes.

## Pieces

- `strategies.ts` — the registry. Every CPU the lab can field, each with a
  stable `id` and a `version` that moves when its behavior changes
  (`greedy@v1`, `pathfinder@v3`, `full@v4`, `seeker@v1`). The version is
  what logs record, so tournaments stay comparable across algo tweaks.
  `seeker` is a lab-only instrument (full + box detours) for measuring
  box outcomes; the shipped CPU never seeks.
- `log.ts` — the JSONL event schema (v1) and the `BattleLog` collector.
- `runner.ts` — `runBattleGame(seed, southId, northId, opts)`: the real
  engine (createGame → autoPlaceSetup → sanitize-choose-apply loop) driven
  headless, logging every action. Deterministic: same seed +
  `strategyRngSeed`, same game, on any machine.
- `/cpu-battle` — the spectator page: watch one battle, or run a
  tournament of N games and download the logs.

## The log format (JSONL, one event per line)

| event       | when                                           |
|-------------|------------------------------------------------|
| `game_start`| game begins: seed, strategy versions, tunables |
| `setup`     | per player: piece placements + trap positions  |
| `move`      | one step: from/to, cost, terrain, pool state, trap/score/box consequences |
| `nerf`      | one nerf: target piece, tokens left            |
| `turn_end`  | scores snapshot after each turn; `drownedPieceId` when a piece drowned at the endTurn |
| `game_end`  | winner, reason (`five_across`/`attrition`/`turn_cap`), totals |

Coordinates are `[x, y]`. Every event carries `v: 1` (schema version).
Mystery boxes: a collection appears in the `move` event's consequences as
`{ kind: "box", outcome }`; a booby trap logs the box event only (never a
fake trap event). `game_start` tunables include the box odds/costs.

## Replaying a game

Seed + the two `setup` events + the ordered `move`/`nerf`/`turn_end`
events reconstruct the game exactly: `createGame(seed)`, `applySetup` with
the logged placements, then `movePieceStep` / `applyNerf` / `endTurn` per
event. Nothing in the log is derived from a strategy's internals, so a
tuner script can recompute any stat (distance-to-goal deltas, trap hit
rates, nerf conversion) from the raw stream.

## Tuning workflow

1. Run a tournament: e.g. 100 games of `full@v4` vs `pathfinder@v3`.
2. Download the `.jsonl`, hand it to Baloo (or a script).
3. Compare: win rate, average game length, eliminations per game, trap
   hit rate, nerf conversion rate, scores-over-time from `turn_end`.
4. Change the algo, bump the strategy version, re-run — the versions in
   `game_start` keep old and new results from mixing silently.
