"use client";

// The setup screen — Step 4 turns the board preview into the first phase
// of an actual game.
//
// You play South (red, bottom of the board) against a North opponent whose
// setup is auto-placed by the engine and whose traps you never see — the
// page enforces that by simply never handing North's untriggered traps to
// the Board component. All placement rules come from the engine
// (src/lib/game/setup.ts): this page asks it "may this go here?" on every
// click and shows the reason when the answer is no, so the UI and the
// rules can never drift apart.
//
// Movement is Step 5 — once both sides are set up, this screen shows the
// finished setup and who moves first.

import { useMemo, useState } from "react";

import Board, { tileKey } from "@/components/Board";
import {
  CHARACTERS,
  MAX_NEUTRAL_TRAPS,
  NEUTRAL_ROW,
  PIECES_PER_PLAYER,
  TRAPS_PER_PLAYER,
} from "@/lib/game/constants";
import { BIOME_PALETTES, PLAYER_COLORS } from "@/lib/game/palettes";
import {
  ALL_CHARACTERS,
  applySetup,
  autoPlaceSetup,
  canPlacePieceAt,
  canPlaceTrapAt,
  createGame,
  isInPieceZone,
  isInTrapZone,
  type SetupError,
} from "@/lib/game/setup";
import {
  type CharacterId,
  type GameState,
  type Piece,
  type PlayerId,
  type Position,
  type Trap,
} from "@/lib/game/types";

const LOCAL_PLAYER: PlayerId = "south";
const OPPONENT: PlayerId = "north";
const FIRST_SEED = 42;

const ERROR_MESSAGES: Record<SetupError, string> = {
  "wrong-phase": "The game isn't in the setup phase.",
  "already-setup": "You've already locked in your setup.",
  "wrong-piece-count": `You need exactly ${PIECES_PER_PLAYER} pieces placed.`,
  "duplicate-character": "Each character can only be placed once.",
  "piece-outside-zone": "Pieces go in your back 3 rows.",
  "wrong-trap-count": `You need exactly ${TRAPS_PER_PLAYER} traps placed.`,
  "trap-outside-zone": "Traps go in your zone or the neutral row.",
  "too-many-neutral-traps": `At most ${MAX_NEUTRAL_TRAPS} traps may go in the neutral row.`,
  "duplicate-position": "That tile is already taken.",
  "on-water": "Nothing can be placed on water.",
};

type Mode = "pieces" | "traps";

export default function Home() {
  const [seedText, setSeedText] = useState(String(FIRST_SEED));
  const [game, setGame] = useState<GameState>(() => createGame(FIRST_SEED));
  const [mode, setMode] = useState<Mode>("pieces");
  const [selectedCharacter, setSelectedCharacter] =
    useState<CharacterId>("cat");
  const [draftPieces, setDraftPieces] = useState<
    Partial<Record<CharacterId, Position>>
  >({});
  const [draftTraps, setDraftTraps] = useState<Position[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const palette = BIOME_PALETTES[game.biome];
  const southApplied = game.pieces.some((p) => p.owner === LOCAL_PLAYER);
  const playing = game.phase === "playing";

  const draftPieceCount = Object.keys(draftPieces).length;
  const neutralTrapCount = draftTraps.filter((p) => p.y === NEUTRAL_ROW).length;
  const setupComplete =
    draftPieceCount === PIECES_PER_PLAYER &&
    draftTraps.length === TRAPS_PER_PLAYER;

  // What the board draws: your drafts while you are placing, the real game
  // pieces once applied. North's untriggered traps are filtered out here —
  // this one expression is the hidden-information rule.
  const displayPieces: Piece[] = useMemo(() => {
    if (southApplied) return game.pieces;
    return ALL_CHARACTERS.filter((c) => draftPieces[c]).map((character) => ({
      id: `${LOCAL_PLAYER}-${character}`,
      character,
      owner: LOCAL_PLAYER,
      position: draftPieces[character]!,
      status: "active" as const,
    }));
  }, [game.pieces, southApplied, draftPieces]);

  const displayTraps: Trap[] = useMemo(() => {
    if (southApplied) {
      return game.traps.filter((t) => t.owner === LOCAL_PLAYER || t.triggered);
    }
    return draftTraps.map((position) => ({
      owner: LOCAL_PLAYER,
      position,
      triggered: false,
    }));
  }, [game.traps, southApplied, draftTraps]);

  // Tiles the current mode may legally use light up. Computed by asking
  // the engine about every candidate tile — no placement rule is repeated
  // in this file.
  const highlighted = useMemo(() => {
    const keys = new Set<string>();
    if (southApplied || playing) return keys;

    if (mode === "pieces") {
      const others = ALL_CHARACTERS.filter(
        (c) => c !== selectedCharacter && draftPieces[c],
      ).map((c) => draftPieces[c]!);
      for (const tile of game.tiles) {
        if (!isInPieceZone(LOCAL_PLAYER, tile.position)) continue;
        if (canPlacePieceAt(game, LOCAL_PLAYER, tile.position, others).ok) {
          keys.add(tileKey(tile.position));
        }
      }
    } else {
      for (const tile of game.tiles) {
        if (!isInTrapZone(LOCAL_PLAYER, tile.position)) continue;
        if (canPlaceTrapAt(game, LOCAL_PLAYER, tile.position, draftTraps).ok) {
          keys.add(tileKey(tile.position));
        }
      }
    }
    return keys;
  }, [
    game,
    mode,
    selectedCharacter,
    draftPieces,
    draftTraps,
    southApplied,
    playing,
  ]);

  function newGame(nextSeed: number) {
    setGame(createGame(nextSeed));
    setSeedText(String(nextSeed));
    setDraftPieces({});
    setDraftTraps([]);
    setSelectedCharacter("cat");
    setMode("pieces");
    setMessage(null);
  }

  function onSeedSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = Number.parseInt(seedText, 10);
    if (Number.isFinite(parsed)) newGame(parsed);
  }

  function handleTileClick(position: Position) {
    if (southApplied || playing) return;
    setMessage(null);

    if (mode === "pieces") {
      // Clicking a placed piece picks it back up.
      const placed = ALL_CHARACTERS.find((c) => {
        const p = draftPieces[c];
        return p && p.x === position.x && p.y === position.y;
      });
      if (placed) {
        setDraftPieces((prev) => {
          const next = { ...prev };
          delete next[placed];
          return next;
        });
        setSelectedCharacter(placed);
        return;
      }
      const others = ALL_CHARACTERS.filter(
        (c) => c !== selectedCharacter && draftPieces[c],
      ).map((c) => draftPieces[c]!);
      const check = canPlacePieceAt(game, LOCAL_PLAYER, position, others);
      if (!check.ok) {
        setMessage(ERROR_MESSAGES[check.error]);
        return;
      }
      const nextDraft = { ...draftPieces, [selectedCharacter]: position };
      setDraftPieces(nextDraft);
      // Advance to the next unplaced character so placing all 15 is
      // click-click-click without touching the tray.
      const nextUnplaced = ALL_CHARACTERS.find((c) => !nextDraft[c]);
      if (nextUnplaced) setSelectedCharacter(nextUnplaced);
      return;
    }

    // Traps mode: clicking toggles.
    const existing = draftTraps.some(
      (p) => p.x === position.x && p.y === position.y,
    );
    if (existing) {
      setDraftTraps((prev) =>
        prev.filter((p) => !(p.x === position.x && p.y === position.y)),
      );
      return;
    }
    const check = canPlaceTrapAt(game, LOCAL_PLAYER, position, draftTraps);
    if (!check.ok) {
      setMessage(ERROR_MESSAGES[check.error]);
      return;
    }
    setDraftTraps((prev) => [...prev, position]);
  }

  function applyMine() {
    const placements = ALL_CHARACTERS.map((character) => ({
      character,
      position: draftPieces[character]!,
    }));
    const result = applySetup(game, LOCAL_PLAYER, placements, draftTraps);
    if (!result.ok) {
      setMessage(ERROR_MESSAGES[result.error]);
      return;
    }
    setGame(result.state);
    setMessage("Your setup is locked in. Start the game when you're ready.");
  }

  function autoPlaceMine() {
    const result = autoPlaceSetup(game, LOCAL_PLAYER);
    if (!result.ok) {
      setMessage(ERROR_MESSAGES[result.error]);
      return;
    }
    setGame(result.state);
    setDraftPieces({});
    setDraftTraps([]);
    setMessage("Auto-placed. Start the game when you're ready.");
  }

  function startGame() {
    // North's setup is auto-placed by the same engine — its traps stay
    // hidden because displayTraps never includes them.
    const result = autoPlaceSetup(game, OPPONENT);
    if (!result.ok) {
      setMessage(ERROR_MESSAGES[result.error]);
      return;
    }
    setGame(result.state);
    setMessage(null);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center gap-5 bg-neutral-950 px-4 py-10 text-neutral-100">
      <header className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">T-rain</h1>
        <p className="mt-1 text-sm text-neutral-400">
          {playing
            ? "Setup complete — both armies are on the board."
            : "Setup: place your pieces and hide your traps."}
        </p>
      </header>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <span className="rounded-full bg-neutral-800 px-3 py-1 text-sm">
          Seed <span className="font-mono font-semibold">{game.seed}</span>
        </span>
        <span className="rounded-full bg-neutral-800 px-3 py-1 text-sm">
          Biome <span className="font-semibold">{palette.label}</span>
        </span>
        <button
          type="button"
          onClick={() => newGame(Math.floor(Math.random() * 1_000_000))}
          className="rounded-full bg-neutral-700 px-4 py-1.5 text-sm font-semibold transition hover:bg-neutral-600"
        >
          🎲 New game
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

      {!playing && !southApplied && (
        <>
          <p className="text-center text-sm text-neutral-300">
            You are{" "}
            <span
              className="font-semibold"
              style={{ color: PLAYER_COLORS[LOCAL_PLAYER] }}
            >
              South (red)
            </span>
            . Place {PIECES_PER_PLAYER} pieces in your back 3 rows, then{" "}
            {TRAPS_PER_PLAYER} traps in your zone + the neutral row (max{" "}
            {MAX_NEUTRAL_TRAPS} neutral). Legal tiles are outlined white — click
            a placed piece to pick it back up.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setMode("pieces")}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                mode === "pieces"
                  ? "bg-emerald-600 text-white"
                  : "bg-neutral-800 hover:bg-neutral-700"
              }`}
            >
              🐾 Pieces · {draftPieceCount}/{PIECES_PER_PLAYER}
            </button>
            <button
              type="button"
              onClick={() => setMode("traps")}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                mode === "traps"
                  ? "bg-emerald-600 text-white"
                  : "bg-neutral-800 hover:bg-neutral-700"
              }`}
            >
              💣 Traps · {draftTraps.length}/{TRAPS_PER_PLAYER} (neutral{" "}
              {neutralTrapCount}/{MAX_NEUTRAL_TRAPS})
            </button>
          </div>

          {mode === "pieces" && (
            <div className="flex max-w-xl flex-wrap items-center justify-center gap-1.5">
              {ALL_CHARACTERS.map((character) => {
                const placed = Boolean(draftPieces[character]);
                const selected = character === selectedCharacter;
                return (
                  <button
                    key={character}
                    type="button"
                    onClick={() => setSelectedCharacter(character)}
                    className={`rounded-full px-2.5 py-1 text-sm transition ${
                      selected
                        ? "bg-white text-black"
                        : placed
                          ? "bg-neutral-800 text-neutral-500"
                          : "bg-neutral-800 hover:bg-neutral-700"
                    }`}
                    title={CHARACTERS[character].label}
                  >
                    {CHARACTERS[character].emoji} {CHARACTERS[character].label}
                    {placed ? " ✓" : ""}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {message && (
        <p className="rounded-lg bg-amber-500/15 px-4 py-2 text-center text-sm text-amber-300">
          {message}
        </p>
      )}

      <Board
        tiles={game.tiles}
        biome={game.biome}
        pieces={displayPieces}
        traps={displayTraps}
        highlighted={highlighted}
        onTileClick={southApplied || playing ? undefined : handleTileClick}
      />

      {!playing && !southApplied && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              setDraftPieces({});
              setDraftTraps([]);
              setMessage(null);
            }}
            className="rounded-full bg-neutral-800 px-4 py-1.5 text-sm transition hover:bg-neutral-700"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={autoPlaceMine}
            className="rounded-full bg-neutral-800 px-4 py-1.5 text-sm transition hover:bg-neutral-700"
          >
            🎲 Auto-place mine
          </button>
          <button
            type="button"
            onClick={applyMine}
            disabled={!setupComplete}
            className="rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Lock in my setup
          </button>
        </div>
      )}

      {southApplied && !playing && (
        <button
          type="button"
          onClick={startGame}
          className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500"
        >
          ▶ Start game — North sets up in secret
        </button>
      )}

      {playing && (
        <section className="flex flex-col items-center gap-2 text-center">
          <p className="text-lg">
            <span style={{ color: PLAYER_COLORS.north }} className="font-bold">
              North {game.scores.north}
            </span>
            {" · "}
            <span style={{ color: PLAYER_COLORS.south }} className="font-bold">
              South {game.scores.south}
            </span>
          </p>
          <p className="text-sm text-neutral-300">
            {game.currentPlayer === LOCAL_PLAYER ? "You move" : "North moves"}{" "}
            first. Your{" "}
            {game.traps.filter((t) => t.owner === LOCAL_PLAYER).length} traps
            are hidden on the board; North&rsquo;s are hidden from you. Movement
            arrives in Step 5.
          </p>
          <p className="text-xs text-neutral-500">
            Board seed {game.seed} · {palette.label} biome
          </p>
        </section>
      )}
    </main>
  );
}
