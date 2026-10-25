# T-rain

A turn-based tactics game on shifting terrain. Guide 5 of your 15 creatures
across the board before your opponent does — and mind the hidden traps.

**Play it now: [t-rain.vercel.app](https://t-rain.vercel.app)** — no account
needed. The full rules are also in the game itself, under
[How to play](https://t-rain.vercel.app/rules).

![A local game in progress on the Desert / Dry board](local-game.png)

## How to play

**The goal.** First player to get 5 of their 15 pieces onto the far row
wins. Pieces are cute animals and characters — cat, dog, frog, alien,
penguin, and more — but they're all identical in how they move, so the
game is pure tactics.

**The board.** 30 × 31 tiles with a neutral row in the middle. Every game
gets one cosmetic biome — grass, desert, or ice — but the terrain itself
always matters:

- **Plains** — costs 1 movement point to enter.
- **Forest** — costs 2 movement points to enter.
- **Water** — impassable, except by the mystery-box bridge (below).

**Setup.** Place your 15 pieces in your back 3 rows, then hide 10 traps in
your own half plus the neutral row (at most 3 on the neutral row). Online
you get 120 seconds; run out of time and the rest auto-place. Your traps
are invisible to your opponent.

**Your turn.** You get a shared pool of 10 movement points per turn, split
across any of your pieces — but no piece may spend more than 3 points in
a turn. Pieces move up, down, left, or right only (no diagonals), can't
share a tile, and can't pass through other pieces. Unspent points don't
carry over.

**Traps.** The instant an enemy piece steps on one of your traps, it's
eliminated and the trap is revealed and spent — even mid-turn, and even
on the goal row, where the trap resolves before scoring.

**Mystery boxes.** One 🎁 mystery box sits in each half of the board, and
only the *invader* can collect it — step a piece onto the box in enemy
territory to roll what's inside:

- **Extra steps (40%)** — +2 free movement points for that piece, this
  turn only.
- **Bridge (25%)** — the piece can cross one water tile, but it must
  reach land the same turn or it drowns, and a water tile never scores.
- **Trap sense (25%)** — for the rest of the turn, the traps on the
  tiles next to that piece are revealed to you, on collection and after
  each of its steps. Revealed traps stay on your board for good — but
  they stay live, so don't step on one later.
- **Booby trap (10%)** — the collecting piece is eliminated.

**Scoring and nerfs.** Each piece that crosses earns you a nerf token
(hold at most 2, usable from your next turn). Spend 1 token + 3 movement
points to eliminate an enemy piece standing next to one of yours — no
trap check, no moving required.

**Losing by attrition.** If you ever drop below 5 pieces able to score,
you lose on the spot, no matter the score.

## Ways to play

![The T-rain home page: local game, CPU battle lab, and online game](home.png)

- **Local game** — against the CPU, or a friend on the same device
  (hotseat). The CPU plays from the same limited view you have: it can't
  see your untriggered traps.
- **Online game** — create a game from the home page and share the invite
  link. The server holds the game state, your opponent's traps stay
  hidden, and turns sync automatically. First player is random.
- **CPU battle lab** — watch CPU strategies play each other, run
  tournaments, and download JSONL logs for tuning.

Sound effects are synthesized in-game (Web Audio, no audio files) with a
mute toggle on every game screen.

## For developers

Built with Next.js 16, React 19, Tailwind CSS v4, and TypeScript.

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

### Environment variables

Copy these into `.env.local` (gitignored) for local development, and set
them in the Vercel project settings for production.

| Variable      | Required | Description                                                                                                          |
| ------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `BASE_URL`    | Yes      | Base domain used to build absolute invite links for online games. e.g. `http://localhost:3000` for dev. `POST /api/games` fails without it. |
| `MONGODB_URI` | No       | MongoDB Atlas connection string. When unset, the server keeps games in an in-memory store (fine for local dev; games don't survive restarts). |
| `MONGODB_DB`  | No       | Database name for game records. Defaults to `train`.                                                                  |

### Design docs

The full specs live at the repo root and stay in sync with the engine:

- `SPEC.md` — core rules and board generation.
- `NETWORK_SPEC.md` — online play, polling, and hidden information.
- `NERF_SPEC.md` — nerf tokens and costs.
- `POWERUPS_SPEC.md` — mystery boxes, including trap sense.
- `CPU_STRATEGY.md` — the CPU's nerf → hunt → spoiler → race design.
- `SOUND_SPEC.md` — sound effects.
