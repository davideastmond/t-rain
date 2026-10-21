# CPU Strategy

How the T-rain CPU opponent thinks. Engine: `src/lib/game/cpu.ts`, wired into
the local game page (`src/app/local/page.tsx`) via `chooseCpuAction`.

## The one rule

The CPU never sees what it shouldn't. Every decision is made from
`sanitizeForPlayer(state, player)` — the exact filter an online server applies
before sending a game to a client. The opponent's untriggered traps are
removed; everything else (all pieces, spent/revealed traps, token counts,
pool) is public. If the CPU ever gets a memory, it must be built from public
information only.

## Each tick

1. **Nerf first** (NERF_SPEC.md §8). If `nerfTargets()` is non-empty — i.e. the
   CPU holds a token, has 3+ pool points, and an enemy piece stands next to
   one of its pieces — it eliminates the valid target closest to scoring
   (the most advanced enemy runner).
2. **Nerf hunting** (see below): holding a token with no adjacent target,
   route a piece next to a top runner to manufacture the nerf this turn.
3. **Spoiler mode** (see below): when the race is lost, intercept the most
   imminent threat's path instead of advancing.
4. **Otherwise, take the best route step** (see below).
5. **Otherwise, end the turn** (`chooseCpuAction` returns null when nothing is
   legal).

## Pathfinding

`findPathToGoal(view, pieceId)` runs Dijkstra over the 4-directional grid:

- Stepping onto a tile costs its `costToEnter` (plains 1, forest 2).
- Water is impassable; tiles occupied by any active piece are walls.
- The goal is any tile on the owner's goal row.
- **Bridge exception**: a piece holding a mystery-box bridge may route
  through one water tile at cost 1. The search tracks whether the bridge
  is still in hand, so a route never plans a second water entry, and
  from a water tile only land is reachable — the crossing always
  completes instead of stranding the piece mid-river. The CPU never
  *seeks* boxes (v1); it just uses a bridge it happens to hold.

`chooseCpuStep` routes every active piece, then takes the first step of the
best route:

1. Lowest `totalCost`.
2. Fewest steps — fewer tiles entered means fewer trap rolls.
3. Random pick among remaining ties (seedable `rng`, so tests are deterministic).

A route only counts if its first step is legal *right now* (checked against
`legalStepTargets`), so the per-piece cap (3/turn), the shared pool, and
newly-appeared blockers are all respected — the CPU switches pieces instead
of stalling.

Routes are recomputed every tick. There is no stored plan to go stale: the CPU
naturally sticks with a piece while its route stays best and re-routes the
moment a wall of pieces, a water pocket, or the per-piece cap changes the
picture.

## Nerf hunting

The opportunistic nerf only fires when a runner blunders next to a CPU
piece. `chooseNerfHuntStep` manufactures the opportunity instead: holding
a token, the CPU routes one of its pieces to a tile adjacent to one of
the opponent's two most advanced runners, and the nerf-first check fires
later in the same turn once adjacency holds. It's the human play —
defend your zone, walk up to the runner, delete it — bounded so it can't
turn into a brawl:

- **Targets**: the two most advanced enemy runners (fewest rows from
  scoring). In spoiler mode, only the single most advanced — a hunt
  never spends the pool a last-ditch interception needs.
- **This turn only**: the hunter's whole route must fit its remaining
  per-piece cap *and* leave 3 pool points for the nerf itself. If the
  kill can't complete this turn, the CPU doesn't start it.
- **Never when one score from winning**: at `piecesToWin == 1` the CPU
  just races.

Elimination beats interception, so hunting outranks spoiler mode: if
the imminent scorer can be killed outright this turn, that's better
than standing in its way.

## Spoiler mode

Blocking is a bad trade while the race is live — every piece on defense is
one not scoring, blockers are nerf-bait, and the board is usually too wide
to funnel anyone. So the CPU only disrupts when racing is hopeless:
`isSpoilerMode` is true when the opponent needs one more score and the CPU
needs at least two. (Both needing one is a straight race — keep racing.)

In spoiler mode, `chooseSpoilerStep` intercepts the most imminent threat:
the enemy piece fewest steps from scoring (routed with the same Dijkstra).
Each of our pieces is routed to the nearest tile of that threat's path;
the fastest blocker wins, tie-broken by the tile earliest on the threat's
path (sooner block) and then by tiles not adjacent to an enemy piece
(don't feed the opponent's nerf). Standing on the path forces the threat
to detour around the blocker. If no interception is reachable, it falls
back to racing — a wasted turn helps nobody.

Nerf still comes first in spoiler mode: targeted removal beats positional
blocking. Hunting does too — but restricted to the most advanced runner,
so it can only ever spend pool on killing the piece spoiler mode exists
to stop.

## What it doesn't do

- **Hidden traps are unknowable.** Untriggered opponent traps aren't in the
  sanitized view, so no route can avoid them — same as a human. Spent
  (triggered) traps are visible and harmless, so they need no avoiding.
- **No multi-turn budgeting.** It spends the pool greedily each turn; the
  engine's caps are the only restraint.
- **No opponent modeling.** It doesn't predict where runners will move;
  hunting and spoiler mode react to where runners are, not where they'll be.

## Tuning knobs

- Tiebreak order in `chooseCpuStep` (cost → steps → random).
- `findPathToGoal` treats every non-water, unoccupied tile as routable;
  weighting tiles near known trap deaths would be the honest way to add
  "trap memory" later.
- The nerf heuristic (most-advanced target) lives in `chooseCpuAction`;
  the hunt scope (top-2 targets, top-1 in spoiler mode, this-turn
  feasibility) lives in `chooseNerfHuntStep`.
