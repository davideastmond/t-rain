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
// Step 5 adds play: once both sides are set up, the current player clicks
// one of their pieces and steps it tile by tile (src/lib/game/movement.ts).
// Play is hotseat-style for now — both sides move on this screen, and trap
// visibility follows whose turn it is, the same filter an online client
// would apply.
//
// Step 7 adds a CPU opponent: when enabled, North's turns are played by a
// greedy heuristic (src/lib/game/cpu.ts) that only ever sees the sanitized
// per-player view — North's untriggered traps stay hidden from you, and the
// CPU can't see yours.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";

import Board, { tileKey } from "@/components/Board";
import SetupTray, { type SetupMode } from "@/components/SetupTray";
import { sanitizeForPlayer } from "@/lib/game/cpu";
import {
  chooseDifficultyAction,
  chooseDifficultySetup,
  CPU_DIFFICULTIES,
  type CpuDifficulty,
} from "@/lib/game/difficulty";
import {
  CHARACTERS,
  EXTRA_STEPS_POINTS,
  MAX_NEUTRAL_TRAPS,
  MAX_POINTS_PER_PIECE_PER_TURN,
  MOVEMENT_POINTS_PER_TURN,
  NERF_POOL_COST,
  NERF_TOKEN_CAP,
  NEUTRAL_ROW,
  PIECES_PER_PLAYER,
  PIECES_TO_WIN,
  TRAPS_PER_PLAYER,
} from "@/lib/game/constants";
import {
  playerLabel,
  SETUP_ERROR_MESSAGES,
  NERF_ERROR_MESSAGES,
  MOVE_ERROR_MESSAGES as SHARED_MOVE_ERROR_MESSAGES,
} from "@/lib/game/messages";
import {
  endTurn,
  findDrownedPiece,
  getPiece,
  legalStepTargets,
  movePieceStep,
  pieceAt,
  type MoveError,
} from "@/lib/game/movement";
import { applyNerf, nerfTargets } from "@/lib/game/nerf";
import { BIOME_PALETTES, PLAYER_COLORS } from "@/lib/game/palettes";
import {
  isMuted,
  playSound,
  playStepSounds,
  setMuted,
  soundForStepOutcome,
  subscribeMuted,
} from "@/lib/sound";
import {
  ALL_CHARACTERS,
  applySetup,
  autoPlaceSetup,
  canPlacePieceAt,
  canPlaceTrapAt,
  createGame,
  isInPieceZone,
  isInTrapZone,
} from "@/lib/game/setup";
import {
  type CharacterId,
  type GameState,
  type MysteryBoxOutcome,
  type Piece,
  type PlayerId,
  type Position,
  type Trap,
} from "@/lib/game/types";

const LOCAL_PLAYER: PlayerId = "south";
const OPPONENT: PlayerId = "north";
const CPU_PLAYER: PlayerId = "north";
const FIRST_SEED = 42;
/** Pause between CPU steps so its turn is watchable, not instantaneous. */
const CPU_STEP_DELAY_MS = 350;

// In hotseat mode the not-your-turn error means you clicked the other
// player's piece, so it gets a more specific message than the default.
const MOVE_ERROR_MESSAGES: Record<MoveError, string> = {
  ...SHARED_MOVE_ERROR_MESSAGES,
  "not-your-turn": "That piece belongs to the other player.",
};

/** Narration for a mystery box collection (the booby trap is narrated
    with the eliminations instead, so it isn't handled here). */
function boxMessage(who: string, box: MysteryBoxOutcome): string {
  switch (box) {
    case "extra-steps":
      return `🎁 ${who} opened a mystery box: +${EXTRA_STEPS_POINTS} free steps this turn!`;
    case "bridge":
      return `🎁 ${who} opened a mystery box: 🌉 a bridge! It can cross one water tile.`;
    case "trap-sense":
      return `🎁 ${who} opened a mystery box: 🔍 trap sense! Nearby traps are revealed to it this turn.`;
    case "booby-trap":
      return `🎁 ${who} opened a mystery box — 💥 booby trap!`;
  }
}

/**
 * The trap-sense addendum to a step's message: what the step just
 * revealed to the moving player (POWERUPS_SPEC.md §6). Only ever used
 * for the human player's own steps — the CPU's reveals are its private
 * knowledge and are never narrated on this screen.
 */
function revealNote(revealed: Position[]): string {
  if (revealed.length === 0) return "";
  if (revealed.length === 1) {
    const p = revealed[0];
    return ` 🔍 Trap sense revealed a trap at (${p.x}, ${p.y}) — it's still live!`;
  }
  return ` 🔍 Trap sense revealed ${revealed.length} traps — they're still live!`;
}

export default function LocalGamePage() {
  const [seedText, setSeedText] = useState(String(FIRST_SEED));
  const [game, setGame] = useState<GameState>(() => createGame(FIRST_SEED));
  const [mode, setMode] = useState<SetupMode>("pieces");
  const [selectedCharacter, setSelectedCharacter] =
    useState<CharacterId>("cat");
  const [draftPieces, setDraftPieces] = useState<
    Partial<Record<CharacterId, Position>>
  >({});
  const [draftTraps, setDraftTraps] = useState<Position[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  /** Nerf targeting mode: red highlights, clicks execute nerfs. */
  const [nerfArmed, setNerfArmed] = useState(false);
  const [turnCount, setTurnCount] = useState(0);
  // Bumps on every new game so piece markers remount instead of animating
  // from the previous game's positions.
  const [gameId, setGameId] = useState(0);
  const [cpuMode, setCpuMode] = useState(true);
  const [difficulty, setDifficulty] = useState<CpuDifficulty>("normal");
  // Sound on by default; the persisted preference takes over after
  // hydration (the server snapshot is always "on", so no mismatch).
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false);
  function toggleMute() {
    setMuted(!muted);
  }
  /** Win/lose stinger for a finished game, delayed so it lands after
      the step's own sound. In CPU mode the human is South; in hotseat
      both sides are human, so any win celebrates. */
  const playGameEndSound = useCallback(
    (state: GameState) => {
      if (state.phase !== "finished" || !state.winner) return;
      const winner = state.winner;
      window.setTimeout(() => {
        playSound(!cpuMode || winner === LOCAL_PLAYER ? "win" : "lose");
      }, 300);
    },
    [cpuMode],
  );

  const palette = BIOME_PALETTES[game.biome];
  const southApplied = game.pieces.some((p) => p.owner === LOCAL_PLAYER);
  const inSetup = game.phase === "setup";
  const playing = game.phase === "playing";
  const finished = game.phase === "finished";
  const cpuTurn = cpuMode && playing && game.currentPlayer === CPU_PLAYER;
  const selectedPiece = selectedPieceId
    ? getPiece(game, selectedPieceId)
    : undefined;

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
      hasBridge: false,
      hasTrapSense: false,
    }));
  }, [game.pieces, southApplied, draftPieces]);

  // Whose eyes the board is drawn through. While waiting to start, you
  // (South) review your own setup. During hotseat play, visibility
  // follows the turn: the player to move sees their own hidden
  // information. Against the CPU, visibility is pinned to you — North's
  // secrets stay hidden all game.
  const visibleOwner: PlayerId =
    cpuMode || inSetup ? LOCAL_PLAYER : game.currentPlayer;

  const displayTraps: Trap[] = useMemo(() => {
    if (!southApplied) {
      return draftTraps.map((position) => ({
        owner: LOCAL_PLAYER,
        position,
        triggered: false,
      }));
    }
    // The game is over: hidden information ends with it — every
    // untriggered trap is revealed on the board (post-game reveal).
    if (finished) return game.traps;
    // The viewer's own untriggered traps, every triggered trap (public
    // once fired), plus the opponent traps trap sense has revealed to
    // the viewer (POWERUPS_SPEC.md §6) — revealed ones stay visible for
    // the rest of the game, but only ever through the viewer's eyes:
    // in CPU mode the CPU's own reveals never leak into your board.
    const revealedKeys = new Set(game.revealedTraps[visibleOwner].map(tileKey));
    return game.traps.filter(
      (t) =>
        t.owner === visibleOwner ||
        t.triggered ||
        revealedKeys.has(tileKey(t.position)),
    );
  }, [game.traps, game.revealedTraps, visibleOwner, southApplied, draftTraps, finished]);

  // Which of the drawn traps are there *because* trap sense revealed
  // them to the viewer — Board labels those "Revealed trap".
  const displayRevealedTrapKeys = useMemo(() => {
    // Post-game, the "revealed" set is the opponent's traps that were
    // hidden all game — the board labels them as post-game reveals.
    if (finished) {
      return new Set(
        game.traps
          .filter((t) => t.owner !== visibleOwner && !t.triggered)
          .map((t) => tileKey(t.position)),
      );
    }
    return new Set(game.revealedTraps[visibleOwner].map(tileKey));
  }, [game.revealedTraps, game.traps, visibleOwner, finished]);

  // Tiles the current mode may legally use light up. Computed by asking
  // the engine about every candidate tile — no placement rule is repeated
  // in this file.
  const highlighted = useMemo(() => {
    const keys = new Set<string>();

    // During play, highlight where the selected piece may step — straight
    // from the engine's legalStepTargets, so the glow *is* the rule set.
    if (playing) {
      if (selectedPieceId) {
        for (const target of legalStepTargets(game, selectedPieceId)) {
          keys.add(tileKey(target));
        }
      }
      return keys;
    }
    if (southApplied) return keys;

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
    selectedPieceId,
    draftPieces,
    draftTraps,
    southApplied,
    playing,
  ]);

  // Red targets for the nerf toggle — straight from the engine's
  // nerfTargets, so the glow *is* the rule set. Only while armed on a
  // human turn.
  const dangerHighlighted = useMemo(() => {
    const keys = new Set<string>();
    if (playing && nerfArmed && !cpuTurn) {
      for (const target of nerfTargets(game, game.currentPlayer)) {
        keys.add(tileKey(target.position));
      }
    }
    return keys;
  }, [game, playing, nerfArmed, cpuTurn]);

  function newGame(nextSeed: number) {
    setGame(createGame(nextSeed));
    setSeedText(String(nextSeed));
    setDraftPieces({});
    setDraftTraps([]);
    setSelectedCharacter("cat");
    setMode("pieces");
    setNerfArmed(false);
    setMessage(null);
    setSelectedPieceId(null);
    setTurnCount(0);
    setGameId((id) => id + 1);
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
        playSound("place");
        return;
      }
      const others = ALL_CHARACTERS.filter(
        (c) => c !== selectedCharacter && draftPieces[c],
      ).map((c) => draftPieces[c]!);
      const check = canPlacePieceAt(game, LOCAL_PLAYER, position, others);
      if (!check.ok) {
        setMessage(SETUP_ERROR_MESSAGES[check.error]);
        playSound("invalid");
        return;
      }
      const nextDraft = { ...draftPieces, [selectedCharacter]: position };
      playSound("place");
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
      playSound("place");
      return;
    }
    const check = canPlaceTrapAt(game, LOCAL_PLAYER, position, draftTraps);
    if (!check.ok) {
      setMessage(SETUP_ERROR_MESSAGES[check.error]);
      playSound("invalid");
      return;
    }
    playSound("place");
    setDraftTraps((prev) => [...prev, position]);
  }

  function applyMine() {
    const placements = ALL_CHARACTERS.map((character) => ({
      character,
      position: draftPieces[character]!,
    }));
    const result = applySetup(game, LOCAL_PLAYER, placements, draftTraps);
    if (!result.ok) {
      setMessage(SETUP_ERROR_MESSAGES[result.error]);
      return;
    }
    setGame(result.state);
    setMessage("Your setup is locked in. Start the game when you're ready.");
  }

  function autoPlaceMine() {
    const result = autoPlaceSetup(game, LOCAL_PLAYER);
    if (!result.ok) {
      setMessage(SETUP_ERROR_MESSAGES[result.error]);
      return;
    }
    setGame(result.state);
    setDraftPieces({});
    setDraftTraps([]);
    setMessage("Auto-placed. Start the game when you're ready.");
  }

  function startGame() {
    // North's setup comes from the selected difficulty tier (Normal:
    // auto-placed; Hard: choke-point traps) — its traps stay hidden
    // because displayTraps never includes them.
    const result = chooseDifficultySetup(difficulty, game, OPPONENT);
    if (!result.ok) {
      setMessage(SETUP_ERROR_MESSAGES[result.error]);
      return;
    }
    setGame(result.state);
    playSound("start");
    setMessage(
      `${playerLabel(result.state.currentPlayer)} moves first — click one of their pieces, then a glowing tile to step.`,
    );
  }

  // --- Play (Step 5) --------------------------------------------------------

  /** Arm/disarm nerf targeting. Arming clears piece selection — the two
      modes share the board but never mix. */
  function toggleNerf() {
    if (nerfArmed) {
      setNerfArmed(false);
      setMessage(null);
      return;
    }
    const targets = nerfTargets(game, game.currentPlayer);
    if (targets.length === 0) {
      setMessage(
        "No valid nerf targets — an enemy piece must stand next to one of yours.",
      );
      return;
    }
    setSelectedPieceId(null);
    setNerfArmed(true);
    setMessage("⚡ Nerf armed — tap a red-highlighted enemy piece.");
  }

  function handlePlayClick(position: Position) {
    if (!playing) return;

    // Nerf targeting mode: every click is a nerf attempt on the piece
    // under the cursor (or an invalid-target error when there is none).
    if (nerfArmed) {
      const clicked = pieceAt(game, position);
      const result = applyNerf(
        game,
        game.currentPlayer,
        clicked ? clicked.id : "",
      );
      if (!result.ok) {
        setMessage(NERF_ERROR_MESSAGES[result.error]);
        return;
      }
      setGame(result.state);
      playSound("nerf");
      playGameEndSound(result.state);
      setNerfArmed(false);
      setSelectedPieceId(null);
      const victim = getPiece(game, result.outcome.eliminatedPieceId)!;
      const who = `${CHARACTERS[victim.character].emoji} ${playerLabel(victim.owner)} ${CHARACTERS[victim.character].label}`;
      setMessage(
        result.state.phase === "finished"
          ? `⚡ ${playerLabel(game.currentPlayer)}'s nerf eliminates ${who} — and that ends the game!`
          : `⚡ ${playerLabel(game.currentPlayer)}'s nerf eliminates ${who}!`,
      );
      return;
    }

    // Clicking one of the current player's pieces selects it — including
    // switching selection from another piece.
    const clicked = pieceAt(game, position);
    if (clicked && clicked.owner === game.currentPlayer) {
      setSelectedPieceId(clicked.id);
      setMessage(null);
      return;
    }

    if (!selectedPieceId || !selectedPiece) {
      setMessage(
        `Select one of ${playerLabel(game.currentPlayer)}'s pieces first.`,
      );
      return;
    }

    const result = movePieceStep(game, selectedPieceId, position);
    if (!result.ok) {
      setMessage(MOVE_ERROR_MESSAGES[result.error]);
      playSound("invalid");
      return;
    }
    setGame(result.state);
    playStepSounds(result.outcome);
    playGameEndSound(result.state);

    const who = `${CHARACTERS[selectedPiece.character].emoji} ${playerLabel(selectedPiece.owner)} ${CHARACTERS[selectedPiece.character].label}`;
    if (result.outcome.eliminated) {
      setSelectedPieceId(null);
      if (result.outcome.box === "booby-trap") {
        setMessage(
          result.state.phase === "finished"
            ? `${boxMessage(who, "booby-trap")} Eliminated — and that ends the game!`
            : `${boxMessage(who, "booby-trap")} It was eliminated!`,
        );
      } else {
        setMessage(
          result.state.phase === "finished"
            ? `💥 ${who} stepped on a trap — and that ends the game!`
            : `💥 ${who} stepped on a trap and was eliminated! The trap is now revealed.`,
        );
      }
    } else if (result.outcome.scored) {
      setSelectedPieceId(null);
      const earnedToken =
        result.state.nerfTokensPending[selectedPiece.owner] >
        game.nerfTokensPending[selectedPiece.owner];
      setMessage(
        (result.state.phase === "finished"
          ? `🎉 ${who} crossed — that's ${PIECES_TO_WIN}!`
          : `🎉 ${who} crossed! ${playerLabel(selectedPiece.owner)}: ${result.state.scores[selectedPiece.owner]}/${PIECES_TO_WIN}.${earnedToken ? " +1 ⚡ nerf token (usable next turn)." : ""}`) +
          revealNote(result.outcome.revealed),
      );
    } else if (result.outcome.box) {
      setMessage(boxMessage(who, result.outcome.box) + revealNote(result.outcome.revealed));
    } else if (result.outcome.revealed.length > 0) {
      setMessage(revealNote(result.outcome.revealed).trim());
    } else {
      setMessage(null);
    }
  }

  function handleEndTurn() {
    const result = endTurn(game);
    if (!result.ok) return;
    setGame(result.state);
    setSelectedPieceId(null);
    setNerfArmed(false);
    setTurnCount((count) => count + 1);
    const drowned = findDrownedPiece(game, result.state);
    if (drowned) playSound("drown");
    playGameEndSound(result.state);
    if (drowned) {
      const who = `${CHARACTERS[drowned.character].emoji} ${playerLabel(drowned.owner)} ${CHARACTERS[drowned.character].label}`;
      setMessage(
        result.state.phase === "finished"
          ? `🌊 ${who} drowned — it ended its turn on water, and that ends the game!`
          : `🌊 ${who} drowned — it ended its turn on water!`,
      );
      return;
    }
    setMessage(
      `${playerLabel(result.state.currentPlayer)}'s turn — ${MOVEMENT_POINTS_PER_TURN} fresh movement points.`,
    );
  }

  function handleBoardClick(position: Position) {
    if (playing) {
      // Your clicks do nothing while the CPU is mid-turn.
      if (!cpuTurn) handlePlayClick(position);
    } else if (!southApplied) {
      handleTileClick(position);
    }
  }

  // The CPU plays North's turns for it, one step per tick so you can watch.
  // Each tick re-reads `game` from the closure (it's a dependency), applies
  // a single step from the CPU's sanitized view, and lets the re-render
  // schedule the next one. The timer is cancelled if you start a new game
  // mid-turn, and the loop stops on its own when the game finishes.
  useEffect(() => {
    if (!cpuTurn) return;
    const timer = window.setTimeout(() => {
      const action = chooseDifficultyAction(
        difficulty,
        sanitizeForPlayer(game, CPU_PLAYER),
        CPU_PLAYER,
      );
      if (!action) {
        const done = endTurn(game);
        if (done.ok) {
          setGame(done.state);
          setTurnCount((count) => count + 1);
          const drowned = findDrownedPiece(game, done.state);
          if (drowned) playSound("drown");
          playGameEndSound(done.state);
          if (drowned) {
            const who = `${CHARACTERS[drowned.character].emoji} North ${CHARACTERS[drowned.character].label}`;
            setMessage(
              done.state.phase === "finished"
                ? `🌊 ${who} drowned — it ended its turn on water, and that ends the game!`
                : `🌊 ${who} drowned — it ended its turn on water!`,
            );
          } else {
            setMessage("North (CPU) ends its turn.");
          }
        }
        return;
      }
      if (action.kind === "nerf") {
        const result = applyNerf(game, CPU_PLAYER, action.targetPieceId);
        if (!result.ok) {
          const done = endTurn(game);
          if (done.ok) {
            setGame(done.state);
            setTurnCount((count) => count + 1);
          }
          return;
        }
        setGame(result.state);
        playSound("nerf");
        playGameEndSound(result.state);
        setSelectedPieceId(null);
        const victim = getPiece(game, action.targetPieceId)!;
        const who = `${CHARACTERS[victim.character].emoji} ${CHARACTERS[victim.character].label}`;
        setMessage(
          result.state.phase === "finished"
            ? `⚡ North's nerf eliminates your ${who} — and that ends the game!`
            : `⚡ North's nerf eliminates your ${who}!`,
        );
        return;
      }
      const result = movePieceStep(game, action.pieceId, action.to);
      if (!result.ok) {
        const done = endTurn(game);
        if (done.ok) {
          setGame(done.state);
          setTurnCount((count) => count + 1);
        }
        return;
      }
      setGame(result.state);
      // Base sound only: the CPU's trap-sense reveals are private to
      // it, so the shimmer must never play for its steps.
      playSound(soundForStepOutcome(result.outcome));
      playGameEndSound(result.state);
      setSelectedPieceId(null);

      const piece = getPiece(game, action.pieceId)!;
      const who = `${CHARACTERS[piece.character].emoji} North ${CHARACTERS[piece.character].label}`;
      if (result.outcome.eliminated) {
        if (result.outcome.box === "booby-trap") {
          setMessage(
            result.state.phase === "finished"
              ? `${boxMessage(who, "booby-trap")} Eliminated — and that ends the game!`
              : `${boxMessage(who, "booby-trap")} It was eliminated!`,
          );
        } else {
          setMessage(
            result.state.phase === "finished"
              ? `💥 ${who} walked into one of your traps — and that ends the game!`
              : `💥 ${who} walked into one of your traps and was eliminated!`,
          );
        }
      } else if (result.outcome.scored) {
        setMessage(
          result.state.phase === "finished"
            ? `🎉 ${who} crossed — that's ${PIECES_TO_WIN}! North wins.`
            : `🎉 ${who} crossed! North: ${result.state.scores.north}/${PIECES_TO_WIN}.`,
        );
      } else if (result.outcome.box) {
        setMessage(boxMessage(who, result.outcome.box));
      } else {
        setMessage("North (CPU) is thinking…");
      }
    }, CPU_STEP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [game, cpuMode, difficulty, playing, cpuTurn, playGameEndSound]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center gap-5 bg-neutral-950 px-4 py-10 text-neutral-100">
      <header className="text-center">
        <Link
          href="/"
          className="mb-2 inline-block text-sm text-neutral-500 transition hover:text-neutral-300"
        >
          ← Home
        </Link>
        <h1 className="text-4xl font-bold tracking-tight">T-rain</h1>
        <p className="mt-1 text-sm text-neutral-400">
          {finished
            ? "Game over."
            : playing
              ? `First to ${PIECES_TO_WIN} pieces across wins.`
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
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? "Unmute sounds" : "Mute sounds"}
          title={muted ? "Sounds muted" : "Sounds on"}
          className="rounded-full bg-neutral-800 px-3 py-1.5 text-sm font-medium transition hover:bg-neutral-700"
        >
          {muted ? "🔇 Muted" : "🔊 Sound"}
        </button>
        {!playing && !finished && (
          <label className="flex cursor-pointer items-center gap-2 rounded-full bg-neutral-800 px-3 py-1.5 text-sm select-none">
            <input
              type="checkbox"
              checked={cpuMode}
              onChange={(event) => setCpuMode(event.target.checked)}
              className="accent-emerald-500"
            />
            🤖 CPU plays North
          </label>
        )}
        {!playing && !finished && cpuMode && (
          <label className="flex items-center gap-2 rounded-full bg-neutral-800 px-3 py-1.5 text-sm">
            Difficulty
            <select
              value={difficulty}
              onChange={(event) =>
                setDifficulty(event.target.value as CpuDifficulty)
              }
              aria-label="CPU difficulty"
              className="rounded-full bg-neutral-700 px-2 py-0.5 text-sm"
            >
              <option value="normal">Normal</option>
              <option value="hard">Hard</option>
            </select>
          </label>
        )}
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
            a placed piece to pick it back up. 🎁 is a mystery box: yours waits
            in the enemy zone, and a trap can&apos;t sit on one.
          </p>

          <SetupTray
            mode={mode}
            onModeChange={setMode}
            draftPieceCount={draftPieceCount}
            trapCount={draftTraps.length}
            neutralTrapCount={neutralTrapCount}
            draftPieces={draftPieces}
            selectedCharacter={selectedCharacter}
            onSelectCharacter={setSelectedCharacter}
          />
        </>
      )}

      {/*
        The banner slot is always rendered with room for two lines
        (text-sm line-height 20px × 2 + py-2 16px = 56px). It used to
        mount/unmount with the message, which moved the board below it
        by ~56px on every click that set or cleared a message — the
        "scroll shift" on tile clicks. Now only the text and the amber
        background come and go; the board stays put. A 3-line message
        on a narrow phone can still grow the slot by one line.
      */}
      <p
        aria-live="polite"
        className={`min-h-[56px] rounded-lg px-4 py-2 text-center text-sm ${
          message ? "bg-amber-500/15 text-amber-300" : "text-transparent"
        }`}
      >
        {message ?? " "}
      </p>

      <Board
        tiles={game.tiles}
        biome={game.biome}
        pieces={displayPieces}
        traps={displayTraps}
        revealedTrapKeys={displayRevealedTrapKeys}
        nerfMarkers={game.nerfMarkers}
        postGame={finished}
        mysteryBoxes={game.mysteryBoxes}
        highlighted={highlighted}
        dangerHighlighted={dangerHighlighted}
        piecesKey={gameId}
        selectedKey={
          playing && selectedPiece ? tileKey(selectedPiece.position) : undefined
        }
        onTileClick={
          finished || (southApplied && inSetup) || cpuTurn
            ? undefined
            : handleBoardClick
        }
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

      {southApplied && inSetup && (
        <button
          type="button"
          onClick={startGame}
          className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500"
        >
          ▶ Start game — North sets up in secret
        </button>
      )}

      {(playing || finished) && (
        <section className="flex flex-col items-center gap-3 text-center">
          <p className="text-lg">
            <span style={{ color: PLAYER_COLORS.north }} className="font-bold">
              North {game.scores.north}
            </span>
            <span className="text-neutral-500"> / {PIECES_TO_WIN} · </span>
            <span style={{ color: PLAYER_COLORS.south }} className="font-bold">
              South {game.scores.south}
            </span>
            <span className="text-neutral-500"> / {PIECES_TO_WIN}</span>
          </p>
          {cpuMode && (
            <p className="text-sm text-neutral-400">
              CPU difficulty: {CPU_DIFFICULTIES[difficulty].label}
            </p>
          )}

          {finished ? (
            <>
              <p className="text-2xl font-bold">
                🏆{" "}
                <span
                  style={{
                    color: game.winner
                      ? PLAYER_COLORS[game.winner]
                      : undefined,
                  }}
                >
                  {game.winner ? playerLabel(game.winner) : ""}
                </span>{" "}
                wins the game!
              </p>
              <p className="max-w-md text-sm text-neutral-300">
                {game.winner && game.scores[game.winner] >= PIECES_TO_WIN
                  ? `${PIECES_TO_WIN} pieces crossed the board — settled in ${turnCount} turns.`
                  : `Settled by attrition in ${turnCount} turns: the loser dropped below ${PIECES_TO_WIN} pieces still able to score.`}
              </p>
              <p className="max-w-md text-sm text-neutral-400">
                Every hidden trap is now revealed on the board —{" "}
                {playerLabel("north")} had{" "}
                {
                  game.traps.filter(
                    (t) => t.owner === "north" && !t.triggered,
                  ).length
                }{" "}
                that never fired, {playerLabel("south")} had{" "}
                {
                  game.traps.filter(
                    (t) => t.owner === "south" && !t.triggered,
                  ).length
                }
                .
              </p>
              <div className="flex flex-wrap justify-center gap-3 text-sm">
                {(["north", "south"] as PlayerId[]).map((player) => (
                  <div
                    key={player}
                    className="flex flex-col items-center gap-0.5 rounded-lg bg-neutral-900 px-5 py-3"
                  >
                    <span
                      className="font-semibold"
                      style={{ color: PLAYER_COLORS[player] }}
                    >
                      {playerLabel(player)}
                    </span>
                    <span>🎉 {game.scores[player]} crossed</span>
                    <span>
                      💥{" "}
                      {
                        game.pieces.filter(
                          (p) =>
                            p.owner === player && p.status === "eliminated",
                        ).length
                      }{" "}
                      eliminated
                    </span>
                    <span>
                      🐾{" "}
                      {
                        game.pieces.filter(
                          (p) => p.owner === player && p.status === "active",
                        ).length
                      }{" "}
                      still on the board
                    </span>
                    <span>
                      🪤{" "}
                      {
                        game.traps.filter(
                          (t) => t.owner === player && t.triggered,
                        ).length
                      }{" "}
                      traps fired
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    newGame(Math.floor(Math.random() * 1_000_000_000))
                  }
                  className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500"
                >
                  🔄 Rematch — new board
                </button>
                <button
                  type="button"
                  onClick={() => newGame(game.seed)}
                  className="rounded-full bg-neutral-800 px-5 py-2 text-sm transition hover:bg-neutral-700"
                >
                  ↩ Replay this board
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-neutral-300">
                <span
                  className="font-semibold"
                  style={{ color: PLAYER_COLORS[game.currentPlayer] }}
                >
                  {playerLabel(game.currentPlayer)}
                </span>{" "}
                to move · Movement points:{" "}
                <span className="font-mono font-semibold">
                  {game.movementPointsLeft}/{MOVEMENT_POINTS_PER_TURN}
                </span>
                {" "}· ⚡{" "}
                <span
                  className="font-mono font-semibold"
                  title="Nerf tokens — earn one per crossing (usable next turn); a nerf costs 1 token + 3 pool points"
                >
                  {game.nerfTokens[game.currentPlayer]}/{NERF_TOKEN_CAP}
                </span>
                {selectedPiece && (
                  <>
                    {" "}
                    · {CHARACTERS[selectedPiece.character].emoji}{" "}
                    {CHARACTERS[selectedPiece.character].label} selected, spent{" "}
                    {game.spentThisTurn[selectedPiece.id] ?? 0}/
                    {MAX_POINTS_PER_PIECE_PER_TURN}
                    {(game.bonusPoints[selectedPiece.id] ?? 0) > 0 && (
                      <> + {game.bonusPoints[selectedPiece.id]}🎁 free</>
                    )}
                    {selectedPiece.hasTrapSense && <> · 🔍 trap sense</>}
                  </>
                )}
                {nerfArmed && (
                  <>
                    {" "}·{" "}
                    <span className="font-semibold text-red-400">
                      nerf targeting — tap a red piece
                    </span>
                  </>
                )}
              </p>
              {cpuTurn ? (
                <p className="animate-pulse text-sm text-neutral-300">
                  🤖 North (CPU) is thinking…
                </p>
              ) : (
                <div className="flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={handleEndTurn}
                    className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500"
                  >
                    End turn ⏭
                  </button>
                  <button
                    type="button"
                    onClick={toggleNerf}
                    disabled={
                      game.nerfTokens[game.currentPlayer] < 1 ||
                      game.movementPointsLeft < NERF_POOL_COST
                    }
                    className={`rounded-full px-5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      nerfArmed
                        ? "bg-red-600 text-white hover:bg-red-500"
                        : "bg-neutral-800 hover:bg-neutral-700"
                    }`}
                  >
                    {nerfArmed ? "⚡ Cancel nerf" : "⚡ Nerf"}
                  </button>
                </div>
              )}
              <p className="max-w-md text-xs text-neutral-500">
                {cpuMode
                  ? "You play South against the CPU. Its untriggered traps stay hidden from you, and it can't see yours — it plays from the same limited view you have."
                  : "Hotseat: both sides play on this screen, and trap visibility follows whose turn it is — the player to move sees only their own untriggered traps."}
              </p>
            </>
          )}
          <p className="text-xs text-neutral-500">
            Board seed {game.seed} · {palette.label} biome
          </p>
        </section>
      )}
    </main>
  );
}
