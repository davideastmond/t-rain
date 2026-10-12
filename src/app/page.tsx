"use client";

// Board preview page — this is Step 3's test harness, not the game UI yet.
//
// It exists so board generation can be *seen*: flip seeds, watch the biome
// change, and check that the terrain mix and the crossing guarantee look
// right. Later steps grow this into the real game screen (setup, then
// turns); the Board component it renders is the one the game will use.
//
// This page needs state (the seed) and a click handler, so it is a Client
// Component — that's all the "use client" above opts into. The board is
// generated in the browser from the seed, which is safe here because
// generation is a pure function: same seed, same board, anywhere.

import { useMemo, useState } from "react";

import Board from "@/components/Board";
import { crossingEntryCount, generateBoard } from "@/lib/game/board";
import { TERRAIN_INFO } from "@/lib/game/types";
import { BIOME_PALETTES } from "@/lib/game/palettes";
import type { TerrainType } from "@/lib/game/types";

const TERRAIN_TYPES: TerrainType[] = ["plains", "forest", "water"];
const FIRST_SEED = 42;

export default function Home() {
  const [seed, setSeed] = useState(FIRST_SEED);
  const [seedText, setSeedText] = useState(String(FIRST_SEED));

  // Regenerate only when the seed changes, not on every render.
  const board = useMemo(() => generateBoard(seed), [seed]);
  const palette = BIOME_PALETTES[board.biome];

  // Tile counts per terrain type, for the legend — also a quick eyeball
  // check that the generation percentages are landing where they should.
  const counts = useMemo(() => {
    const result: Record<TerrainType, number> = { plains: 0, forest: 0, water: 0 };
    for (const tile of board.tiles) result[tile.terrain]++;
    return result;
  }, [board]);

  const crossingEntries = useMemo(
    () => crossingEntryCount(board.tiles),
    [board],
  );

  function goToSeed(next: number) {
    setSeed(next);
    setSeedText(String(next));
  }

  function newRandomBoard() {
    goToSeed(Math.floor(Math.random() * 1_000_000));
  }

  function onSeedSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = Number.parseInt(seedText, 10);
    if (Number.isFinite(parsed)) goToSeed(parsed);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center gap-6 bg-neutral-950 px-4 py-10 text-neutral-100">
      <header className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">T-rain</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Board preview — every seed is a different battlefield.
        </p>
      </header>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <span className="rounded-full bg-neutral-800 px-3 py-1 text-sm">
          Seed <span className="font-mono font-semibold">{seed}</span>
        </span>
        <span className="rounded-full bg-neutral-800 px-3 py-1 text-sm">
          Biome <span className="font-semibold">{palette.label}</span>
        </span>
        <button
          type="button"
          onClick={newRandomBoard}
          className="rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-500"
        >
          🎲 New board
        </button>
        <form onSubmit={onSeedSubmit} className="flex items-center gap-2">
          <input
            value={seedText}
            onChange={(event) => setSeedText(event.target.value)}
            inputMode="numeric"
            aria-label="Seed"
            className="w-24 rounded-full bg-neutral-800 px-3 py-1.5 font-mono text-sm outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            type="submit"
            className="rounded-full bg-neutral-700 px-3 py-1.5 text-sm font-medium transition hover:bg-neutral-600"
          >
            Go to seed
          </button>
        </form>
      </div>

      <Board tiles={board.tiles} biome={board.biome} />

      <section className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
        {TERRAIN_TYPES.map((terrain) => (
          <span key={terrain} className="flex items-center gap-2">
            <span
              className="inline-block h-4 w-4 rounded-sm border border-black/40"
              style={{ backgroundColor: palette.colors[terrain] }}
            />
            <span>
              {palette.terrainLabels[terrain]}{" "}
              <span className="text-neutral-400">
                ({terrain}
                {TERRAIN_INFO[terrain].passable
                  ? `, cost ${TERRAIN_INFO[terrain].costToEnter}`
                  : ", impassable"}
                ) · {counts[terrain]}
              </span>
            </span>
          </span>
        ))}
      </section>

      <p className="text-center text-sm text-neutral-400">
        Crossing routes reach{" "}
        <span className="font-semibold text-neutral-200">{crossingEntries}</span>{" "}
        tiles on the far row — generation guarantees at least 3, so water can
        never seal this board. The outlined row in the middle is the neutral
        row.
      </p>
    </main>
  );
}
