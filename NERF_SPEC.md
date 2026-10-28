# T-rain — Nerf mechanic (spec, v1)

Status: **spec only — no code.** Sequencing: this spec is reviewed now,
but it is *implemented* after Human-vs-Human network play lands. Game
rules in SPEC.md are otherwise unchanged.

## 1. Why

Playtesting surfaced a real hole: a player can park pieces as blockers
on or near the goal row and there is **no counterplay**. Blockers can't
be captured (no capture by movement), can't be pushed, and can't be
trapped (traps live in the attacker's zone — the blockers sit where
traps can't reach). Worse, there is no stalemate breaker: a player
could turtle indefinitely and the game never resolves.

The nerf answers *static* defense without killing defense in general:
it punishes blockers that never move, while mobile defense stays
viable. It is a **player-level resource**, not a piece ability — the
locked "uniform pieces" decision stands.

## 2. Concept

A **nerf** eliminates one active opponent piece. Terminology: "nerf"
throughout (verb and noun: *"South nerfs North's Frog"*, *"spend a
nerf token"*).

## 3. Nerf tokens — earning

- When one of your pieces **crosses** (scores), you earn **1 nerf
  token**.
- **Max 2 tokens held.** Tokens earned beyond the cap are lost — no
  stockpiling a board wipe.
- A token earned on your turn becomes **usable starting your next
  turn** (it sits in a pending count until `endTurn` flips it over).
  This kills the score→nerf→score same-turn snowball.
- State shape (engine):
  `nerfTokens: Record<PlayerId, number>` (usable),
  `nerfTokensPending: Record<PlayerId, number>` (earned this turn).

## 4. The nerf action

On your turn, during the `playing` phase, you may spend **1 token +
3 movement points** from the shared pool to eliminate **one active
opponent piece orthogonally adjacent to at least one of your active
pieces**.

Validation (`canNerf`, error codes):

| Check | `NerfError` |
|---|---|
| Phase is `playing` | `wrong-phase` |
| Acting player is the current player | `not-your-turn` |
| Usable token count ≥ 1 | `no-token` |
| Pool ≥ 3 | `insufficient-points` |
| Target exists, is active, belongs to the opponent, and is orthogonally adjacent to ≥ 1 of your active pieces | `invalid-target` |

Resolution (`applyNerf`), in order:

1. Deduct 3 from `movementPointsLeft`, consume 1 usable token.
2. Target piece → `status: "eliminated"` (position unchanged, same
   convention as trap eliminations; the board stops rendering it).
3. **No trap check.** Nerfing is not movement — traps trigger on
   tile *entry*, and nothing enters a tile here.
4. **Attrition applies.** Eliminated pieces count exactly like trap
   eliminations: if the target's owner's active + scored pieces drop
   below 5, they lose immediately (existing rule, unchanged).

The turn continues afterward — a nerf is an action, not a turn-ender.
Multiple nerfs per turn are allowed if tokens and pool allow (at most
2, costing 6 pool — self-limiting).

## 5. Interactions with existing rules

- **Traps**: none. A nerf neither triggers nor is affected by traps.
- **Per-piece cap (3)**: unaffected — the nerf is not a piece move,
  so the cap doesn't apply; the pool cost is the limiter.
- **Goal row**: nerfing a piece standing on the goal row is allowed
  (that's the point — goal-line campers are the target).
- **Own pieces**: never valid targets.
- **Setup phase**: not available. Tokens can't exist before play
  anyway (earning requires scoring).
- **Scoring**: a nerf can never score a piece; only `movePieceStep`
  onto the goal row scores.

## 6. Balance rationale

Each lever exists to keep the nerf *earned and positional*, never
cheap:

- **Gated behind scoring.** The answer to turtling requires doing
  the hardest thing against a turtler — crossing once. Nobody has
  tokens on turn one; the early game plays exactly as today.
- **Adjacency.** You must march a piece up to the defender, through
  their traps, risking the attacker. No cross-board sniping.
- **Tempo cost.** 3 pool points is 30% of a turn — a real trade
  against movement.
- **Cap of 2, next-turn gating.** No snowballing, no same-turn
  score→nerf combos.
- **It cuts both ways.** The turtler earns tokens by scoring too and
  can nerf *your* runners parked by the goal. Symmetric, like every
  other rule in the game.

Resulting dynamics: goal-line camping goes from free to risky, so
the defender's counter becomes spacing (nerf is single-target) and
traps on approach routes — which makes trap placement a richer
decision than it is today.

## 7. UI sketch (for the implementation PR, no code here)

- Turn panel shows `⚡ Nerf tokens: n/2` next to the pool readout.
- Interaction reuses the existing selection language: a "⚡ Nerf"
  toggle arms targeting; enemy pieces orthogonally adjacent to any
  of your active pieces highlight red; clicking one executes the
  nerf (validation errors surface as messages, same as move
  errors). Auto-disarms after use or when no valid target exists.
- Narration: `⚡ South's nerf eliminates North's 🐸 Frog!` /
  attrition-loss variant.
- The board marks the tile where the nerf landed with a ⚡ (tinted in
  the victim's colour) until the victim's next turn ends — so the
  victim sees, on their own turn, exactly where they lost a piece.

## 8. CPU hook (deferred)

The CPU (Step 7) should earn and spend tokens once this ships.
Suggested heuristic, to be tuned at implementation: when holding a
token with pool ≥ 3, nerf the valid target closest to the CPU's
goal row. No changes needed to `sanitizeForPlayer` — tokens are
per-player counts, not hidden positions.

## 9. Test plan (for the implementation PR)

- Earn: token granted on scoring; capped at 2; pending → usable
  across `endTurn`; no token when already at cap.
- Validation: each `NerfError` code (phase, turn, token, pool,
  adjacency/ownership/activity of target).
- Resolution: pool −3, token consumed, target eliminated in place,
  turn continues, state purity (input untouched).
- Attrition: nerfing the 11th-of-15 piece with 0 scored ends the
  game for the target's owner.
- No trap interaction: nerfing adjacent to / onto trapped tiles
  triggers nothing and reveals nothing.
- Availability: usable no earlier than the turn after earning.

## 10. Open decisions / tuning knobs

1. Token cap (2), pool cost (3), next-turn gating — all tunable
   without changing the shape.
2. Adjacency scope: orthogonal only (spec'd, consistent with
   movement) vs. including diagonals.
3. Name: "nerf" is the working term; alternatives welcome.
