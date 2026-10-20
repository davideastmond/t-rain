// The how-to-play page: a broad overview of the rules for new players.
// Copy mirrors RULES.md; the numbers come from the game constants so
// they can't drift from the engine.

import type { Metadata } from "next";
import Link from "next/link";

import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  MAX_NEUTRAL_TRAPS,
  MAX_POINTS_PER_PIECE_PER_TURN,
  MOVEMENT_POINTS_PER_TURN,
  NERF_POOL_COST,
  NERF_TOKEN_CAP,
  PIECES_PER_PLAYER,
  PIECES_TO_WIN,
  SETUP_ROWS,
  SETUP_TIME_SECONDS,
  TRAPS_PER_PLAYER,
} from "@/lib/game/constants";
import { TERRAIN_INFO } from "@/lib/game/types";

export const metadata: Metadata = {
  title: "How to play · T-rain",
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="flex flex-col gap-2 leading-relaxed text-neutral-300">
        {children}
      </div>
    </section>
  );
}

export default function RulesPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 bg-neutral-950 px-4 py-10 text-neutral-100">
      <div>
        <Link
          href="/"
          className="text-sm text-emerald-400 transition hover:text-emerald-300"
        >
          ← Back to T-rain
        </Link>
        <h1 className="mt-4 text-4xl font-bold tracking-tight">
          How to play
        </h1>
      </div>

      <Section title="The goal">
        <p>
          Race your pieces across the board. First player to get{" "}
          <strong className="text-neutral-100">
            {PIECES_TO_WIN} of their {PIECES_PER_PLAYER} pieces
          </strong>{" "}
          onto the far row wins.
        </p>
      </Section>

      <Section title="The board">
        <p>
          {BOARD_WIDTH}×{BOARD_HEIGHT} tiles, with a neutral row in the
          middle. Each game gets one biome theme (grass, desert, or ice) —
          cosmetic only. Terrain matters:
        </p>
        <ul className="list-disc pl-6">
          <li>
            <strong className="text-neutral-100">Plains</strong> — costs{" "}
            {TERRAIN_INFO.plains.costToEnter} point to enter
          </li>
          <li>
            <strong className="text-neutral-100">Forest</strong> — costs{" "}
            {TERRAIN_INFO.forest.costToEnter} points to enter
          </li>
          <li>
            <strong className="text-neutral-100">Water</strong> — impassable
          </li>
        </ul>
      </Section>

      <Section title={`Setup (${SETUP_TIME_SECONDS} seconds)`}>
        <p>
          Place your {PIECES_PER_PLAYER} pieces in your back {SETUP_ROWS}{" "}
          rows, and hide{" "}
          <strong className="text-neutral-100">
            {TRAPS_PER_PLAYER} traps
          </strong>{" "}
          in your own half plus the neutral row (at most {MAX_NEUTRAL_TRAPS}{" "}
          on the neutral row). Run out of time and the rest auto-place.
        </p>
      </Section>

      <Section title="Your turn">
        <p>
          You get a shared pool of{" "}
          <strong className="text-neutral-100">
            {MOVEMENT_POINTS_PER_TURN} movement points
          </strong>{" "}
          per turn, split across any of your pieces — but no piece may spend
          more than{" "}
          <strong className="text-neutral-100">
            {MAX_POINTS_PER_PIECE_PER_TURN} points
          </strong>{" "}
          in a turn. Pieces move up/down/left/right only (no diagonals),
          can&apos;t share a tile, and can&apos;t pass through other pieces.
          Unspent points don&apos;t carry over.
        </p>
      </Section>

      <Section title="Traps">
        <p>
          Invisible to your opponent. The instant an enemy piece steps on
          one, it&apos;s eliminated and the trap is revealed and spent —
          even mid-turn, and even on the goal row: the trap resolves before
          scoring.
        </p>
      </Section>

      <Section title="Scoring & nerfs">
        <p>
          Each piece that crosses earns you a{" "}
          <strong className="text-neutral-100">nerf token</strong>, usable
          from your next turn (hold at most {NERF_TOKEN_CAP}). Spend{" "}
          <strong className="text-neutral-100">
            1 token + {NERF_POOL_COST} movement points
          </strong>{" "}
          to eliminate an enemy piece that&apos;s next to — orthogonally
          adjacent to — one of yours. No trap check, no moving required.
        </p>
      </Section>

      <Section title="Attrition">
        <p>
          If you ever drop below {PIECES_TO_WIN} pieces able to score, you
          lose on the spot — no matter the score.
        </p>
      </Section>

      <Section title="Playing online">
        <p>
          Create a game from the home page and share the invite link. Your
          opponent joins, both players set up, and turns sync automatically.
          First player is random.
        </p>
      </Section>

      <p className="text-center">
        <Link
          href="/"
          className="text-sm text-emerald-400 transition hover:text-emerald-300"
        >
          ← Back to T-rain
        </Link>
      </p>
    </main>
  );
}
