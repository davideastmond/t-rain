# T-rain sound design & plan (SFX first, music later)

Status: Planned — not yet implemented. SFX first; music is a separate track for later.
Scope: sound effects only. Music (chiptune or otherwise) is a separate
track for later — this doc doesn't plan it.

## Can Baloo create the sounds? Yes — two routes

**Route A (recommended): synthesize in code with the Web Audio API.**
A small module builds each sound from oscillators and noise bursts at
runtime — no audio files, no licensing questions, nothing to download,
and pitch can vary slightly per play so repeated steps don't sound
mechanical. This is the standard way to do retro game SFX, and it's
how the whole list below would be built. Baloo writes the synth code
and the recipes; David tunes by ear and adjusts numbers.

**Route B: generated `.wav` assets committed to the repo.** Baloo can
also synthesize short `.wav` files (e.g. with Python) and check them
in as assets. This is only worth it if a sound needs a character the
oscillator recipes can't reach. It adds files, load time, and a build
step for every tweak — so start with A, reach for B per-sound if ever
needed.

What Baloo *can't* do: record real instruments or produce
studio-quality sampled audio. For T-rain's SFX, that isn't the need.

## The sound list

David's five, plus what was missing (marked ★):

### Core gameplay
- **Piece movement** — one soft blip per step. Slight random detune
  per step so a 3-step move doesn't sound like a machine gun.
- **Stepping on a trap** — harsh burst: noise + descending tone.
  Shared with booby-trap box deaths (same fate, same sound).
- **Getting nerfed** — zap. One sound covers both sides: the player
  who nerfs and the player who loses the piece hear the same event
  (online, each side's client plays it from the `nerfed` event).
- **Getting a mystery box** — ascending chime on collection. The four
  outcomes then get a tail where it matters: booby reuses the trap
  sound; extra-steps and bridge keep the plain chime; ★ **trap-sense
  reveal gets its own shimmer** (it's an information event — the
  player should *hear* that something was revealed, not just see it).
- **Reaching the goal (a score)** — two-note chime, distinct from the
  box chime.

### ★ Missing from the first list
- **Victory / defeat** — the game-finished moment needs its own
  stinger: a short fanfare for the winner, a descending line for the
  loser. Different from a single score, which happens up to 5 times.
- **Your turn (online)** — arguably the most useful sound in the
  game: when the opponent's turn ends and yours begins while you're
  tabbed away, a gentle two-tone tells you to come back. Local play
  doesn't need it (you're already there).
- **Drowning** — a piece that ends its turn on water dies (the bridge
  rule). It exists in the engine today and has no sound in the list.
- **Setup** — placing a piece / placing a trap (a quiet click), setup
  submitted, and game start (a short "go" sound when play begins).
- **Opponent actions (online)** — the opponent's steps, traps, and
  scores arrive through polling; their events should play too, at
  lower volume or a softer variant, so an online game sounds alive
  without doubling your own actions.
- **Invalid action** — a dull buzz for an illegal click (tile you
  can't step to, piece you can't afford to move). Small, but it makes
  the board feel responsive instead of dead.
- **Forfeit** — the opponent forfeits; reuse the defeat/victory
  stinger with the forfeit reason already shown in the feed.

### Deliberately not in scope (yet)
- Per-terrain footsteps (plains vs forest) and bridge-crossing sounds
  — covered by the generic move blip for now. Easy to add later if
  the board ever wants more texture.
- Ambient/background audio — that's the music track, not SFX.

## Design decisions

### Module shape
One module, e.g. `src/lib/sound.ts`, owning everything:
`play(name)` for each sound in the list, plus `setMuted` /
`isMuted`. Each recipe is data (oscillator type, frequency envelope,
duration, noise mix) so tuning is editing numbers, not logic. A pure
mapping function — game outcome → sound name — stays unit-testable
in Node; the actual timbre is tuned by ear in the browser.

### Trigger wiring — local game
The local page already receives everything it needs from the engine:
`StepOutcome` carries `cost`, `eliminated`, `scored`, `box`, and
`revealed` (trap sense); nerfs and end-turn drowning have their own
results; the phase flipping to `finished` marks the win/loss. Sounds
fire in priority order per step: trap > box > scored > plain move
(one sound per step — a step that scores *and* collects plays the box
chime, not two sounds at once), plus trap-sense shimmer whenever
`revealed` is non-empty.

### Trigger wiring — online game
The net page already funnels every server state through
`applyServerState`, which also receives the new events since
`lastEventSeq`. The net event log maps cleanly onto sounds: `step`,
`trap-triggered`, `scored`, `nerfed`, `box-collected`,
`piece-drowned`, `turn-ended` (→ your-turn sound when the ended turn
was the opponent's), `game-finished` (→ win/lose by seat). Driving
sounds from this one funnel means your own actions and the
opponent's play identically, with no double-playing: the step POST
response carries the same events the poll would.

### Browser realities
- **Autoplay policy:** browsers block audio until the user has
  interacted with the page. The sound module creates/resumes its
  `AudioContext` on the first click; before that, `play()` is a
  no-op. This is invisible in practice — every game starts with
  setup clicks — but it means no sound can ever fire before the
  first interaction, including "your turn" for a game opened in a
  background tab.
- **Mute:** a visible toggle in the game header, persisted in
  `localStorage`, default on. Sounds must never be the *only* carrier
  of information — every sound duplicates something already shown
  visually (feed lines, badges, scores).
- **Volume:** one master level; movement softer than events; win/lose
  stingers loudest. No per-sound sliders in v1.

## Strawman recipes (starting points, tune by ear)

| Sound | Recipe sketch |
|---|---|
| Move step | Triangle, 320→220 Hz sweep, 80 ms, quiet, ±10% detune |
| Trap / booby | White-noise burst 200 ms + square 220→60 Hz |
| Nerf | Sawtooth 900→150 Hz zap, 150 ms |
| Box collected | Sine arpeggio 523→659→784 Hz, 60 ms each |
| Trap-sense reveal | High sine sparkle, 1200→1800 Hz, 150 ms |
| Score | Two-note chime, 660→880 Hz |
| Win | Four-note rising arpeggio (~600 ms) |
| Lose | Three descending minor notes (~600 ms) |
| Your turn | Gentle two-tone, 440→660 Hz |
| Drown | Low filtered noise sliding down, 300 ms |
| Place (setup) | Short click, 1000 Hz, 30 ms |
| Game start | Quick rising two-note "go" |
| Invalid | Square 110 Hz buzz, 100 ms |

## Phased build (when approved)

1. **PR 1 — module + local game:** `src/lib/sound.ts`, the mute
   toggle, and wiring for the local game: move, trap, nerf, box,
   trap-sense, score, win/lose, drown, invalid. (The five core
   sounds plus the win/lose distinction.)
2. **PR 2 — online game:** event-funnel wiring in the net page,
   your-turn sound, opponent-action variants.
3. **PR 3 (optional polish):** setup sounds, per-outcome box tails,
   volume tuning pass after playtesting.

Verification per PR: build/tsc/ESLint; the outcome→sound mapping
unit-tested in Node; actual timbre playtested by David in the
browser (a sound's quality can't be asserted by a test).
