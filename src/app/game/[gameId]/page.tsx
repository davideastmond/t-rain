"use client";

// The network game client — Human vs Human over the API routes.
//
// One seat per browser tab, identified by the ?t= bearer token in the URL.
// Game state lives on the server: this page polls GET .../state every 2s
// and applies POST responses directly. There are no optimistic moves —
// the server's answer is the state. The setup screen and turn UI mirror
// the local game's, but every action is a POST and the state is always
// the per-seat filtered view, so the opponent's untriggered traps (and,
// during setup, their pieces) never reach this client.

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useParams, useSearchParams } from "next/navigation";

import Board, { tileKey } from "@/components/Board";
import SetupTray, { type SetupMode } from "@/components/SetupTray";
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
  MOVE_ERROR_MESSAGES,
  NERF_ERROR_MESSAGES,
  playerLabel,
  SETUP_ERROR_MESSAGES,
} from "@/lib/game/messages";
import { getPiece, legalStepTargets, pieceAt } from "@/lib/game/movement";
import type { MoveError } from "@/lib/game/movement";
import { nerfTargets } from "@/lib/game/nerf";
import type { NerfError } from "@/lib/game/nerf";
import { BIOME_PALETTES, PLAYER_COLORS } from "@/lib/game/palettes";
import {
  isMuted,
  playNetEventSounds,
  playSound,
  setMuted,
  subscribeMuted,
} from "@/lib/sound";
import {
  ALL_CHARACTERS,
  canPlacePieceAt,
  canPlaceTrapAt,
  isInPieceZone,
  isInTrapZone,
} from "@/lib/game/setup";
import type { SetupError } from "@/lib/game/setup";
import type { NetEvent } from "@/lib/net/store";
import type {
  CharacterId,
  GameState,
  Piece,
  PlayerId,
  Position,
  Trap,
} from "@/lib/game/types";

const POLL_MS = 2000;

function actionErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    if (error in SETUP_ERROR_MESSAGES)
      return SETUP_ERROR_MESSAGES[error as SetupError];
    if (error in MOVE_ERROR_MESSAGES)
      return MOVE_ERROR_MESSAGES[error as MoveError];
    if (error in NERF_ERROR_MESSAGES)
      return NERF_ERROR_MESSAGES[error as NerfError];
    if (error === "version-conflict") return "The game moved — refreshed.";
    if (error === "malformed-body") return "That request was malformed.";
  }
  return "Something went wrong — try again.";
}

/** Turn fresh poll/POST events into feed lines. Plain steps stay silent. */
function describeEvents(
  events: NetEvent[],
  state: GameState,
): string[] {
  const lines: string[] = [];
  for (const event of events) {
    switch (event.type) {
      case "player-joined":
        lines.push(`👋 ${playerLabel(event.player)} joined the game.`);
        break;
      case "setup-submitted":
        lines.push(`🔒 ${playerLabel(event.player)} locked in their setup.`);
        break;
      case "trap-triggered": {
        const victim = state.pieces.find((p) => p.id === event.victimPieceId);
        const who = victim
          ? `${CHARACTERS[victim.character].emoji} ${playerLabel(victim.owner)} ${CHARACTERS[victim.character].label}`
          : "A piece";
        lines.push(`💥 ${who} stepped on a trap and was eliminated!`);
        break;
      }
      case "scored": {
        const piece = state.pieces.find((p) => p.id === event.pieceId);
        const who = piece
          ? `${CHARACTERS[piece.character].emoji} ${playerLabel(piece.owner)} ${CHARACTERS[piece.character].label}`
          : "A piece";
        lines.push(
          `🎉 ${who} crossed! ${playerLabel(event.player)}: ${event.scores[event.player]}/${PIECES_TO_WIN}.`,
        );
        break;
      }
      case "turn-ended":
        lines.push(`⏭ ${playerLabel(event.player)} ended their turn.`);
        break;
      case "nerfed": {
        const victim = state.pieces.find((p) => p.id === event.targetPieceId);
        const who = victim
          ? `${CHARACTERS[victim.character].emoji} ${playerLabel(victim.owner)} ${CHARACTERS[victim.character].label}`
          : "A piece";
        lines.push(`⚡ ${playerLabel(event.player)}'s nerf eliminates ${who}!`);
        break;
      }
      case "box-collected": {
        const piece = state.pieces.find((p) => p.id === event.pieceId);
        const who = piece
          ? `${CHARACTERS[piece.character].emoji} ${playerLabel(piece.owner)} ${CHARACTERS[piece.character].label}`
          : "A piece";
        if (event.outcome === "extra-steps") {
          lines.push(
            `🎁 ${who} opened a mystery box: +${EXTRA_STEPS_POINTS} free steps this turn!`,
          );
        } else if (event.outcome === "bridge") {
          lines.push(
            `🎁 ${who} opened a mystery box: 🌉 a bridge! It can cross one water tile.`,
          );
        } else if (event.outcome === "trap-sense") {
          lines.push(
            `🎁 ${who} opened a mystery box: 🔍 trap sense! Nearby traps are revealed to it this turn.`,
          );
        } else {
          lines.push(
            `🎁 ${who} opened a mystery box — 💥 booby trap! It was eliminated!`,
          );
        }
        break;
      }
      case "piece-drowned": {
        const piece = state.pieces.find((p) => p.id === event.pieceId);
        const who = piece
          ? `${CHARACTERS[piece.character].emoji} ${playerLabel(piece.owner)} ${CHARACTERS[piece.character].label}`
          : "A piece";
        lines.push(`🌊 ${who} drowned — it ended its turn on water!`);
        break;
      }
      case "forfeited":
        lines.push(`🏳 ${playerLabel(event.player)} forfeited the game.`);
        break;
      case "game-finished":
        lines.push(`🏆 ${playerLabel(event.winner)} wins the game!`);
        break;
      case "game-created":
      case "step":
        break;
    }
  }
  return lines;
}

function GameClient() {
  const params = useParams<{ gameId: string }>();
  const searchParams = useSearchParams();
  const gameId = params.gameId;
  const token = searchParams.get("t");

  const [netState, setNetState] = useState<GameState | null>(null);
  const [seat, setSeat] = useState<PlayerId | null>(null);
  const [setupEndsAt, setSetupEndsAt] = useState<string | null>(null);
  const [opponentSeenAgoSec, setOpponentSeenAgoSec] = useState<number | null>(
    null,
  );
  const [authError, setAuthError] = useState<string | null>(() =>
    searchParams.get("t")
      ? null
      : "This link is invalid — it's missing a seat token.",
  );
  const [busy, setBusy] = useState(false);
  const [feed, setFeed] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());

  // Setup draft (local until locked in).
  const [mode, setMode] = useState<SetupMode>("pieces");
  const [selectedCharacter, setSelectedCharacter] =
    useState<CharacterId>("cat");
  const [draftPieces, setDraftPieces] = useState<
    Partial<Record<CharacterId, Position>>
  >({});
  const [draftTraps, setDraftTraps] = useState<Position[]>([]);
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [forfeitArmed, setForfeitArmed] = useState(false);
  /** Nerf targeting mode: red highlights, clicks execute nerfs. */
  const [nerfArmed, setNerfArmed] = useState(false);

  const versionRef = useRef(0);
  const lastEventSeqRef = useRef(0);
  /**
   * Tile keys of my own trap-sense reveals as last seen — the baseline
   * for narrating *new* reveals. Null until the first state arrives, so
   * joining or reloading mid-game doesn't re-narrate old knowledge.
   */
  const revealedSeenRef = useRef<Set<string> | null>(null);
  /**
   * Same baseline idea for sounds: the first state arrival carries the
   * whole event history (lastEventSeq starts at 0), which must stay
   * silent. Only events arriving after that are live, so only they
   * play.
   */
  const soundsArmedRef = useRef(false);
  /** Previous phase, for the setup → playing "go" sound. Null until
      the first state arrives, so joining mid-game never plays it. */
  const prevPhaseRef = useRef<GameState["phase"] | null>(null);

  // Sound on by default; the persisted preference takes over after
  // hydration (the server snapshot is always "on", so no mismatch).
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false);
  function toggleMute() {
    setMuted(!muted);
  }

  const pushFeed = useCallback((lines: string[]) => {
    if (lines.length === 0) return;
    setFeed((prev) => [...prev, ...lines].slice(-8));
  }, []);

  const applyServerState = useCallback(
    (state: GameState, events: NetEvent[], seat: PlayerId | null) => {
      setNetState(state);
      const prevPhase = prevPhaseRef.current;
      prevPhaseRef.current = state.phase;
      if (prevPhase === "setup" && state.phase === "playing") {
        playSound("start");
      }
      if (events.length > 0) {
        lastEventSeqRef.current = events[events.length - 1].seq;
        pushFeed(describeEvents(events, state));
        const armed = soundsArmedRef.current;
        soundsArmedRef.current = true;
        if (armed) playNetEventSounds(events, state, seat);
      } else {
        soundsArmedRef.current = true;
      }
      // Trap-sense reveals are private knowledge: the server never puts
      // them in the shared event log (a position there would leak to
      // the opponent). This client derives its own reveal lines from
      // its filtered state instead — sanitizeForNetPlayer redacts the
      // opponent's revealed set to [], so the union of both lists in a
      // state I receive is exactly what *I* have revealed.
      const myRevealed = [...state.revealedTraps.north, ...state.revealedTraps.south];
      const myRevealedKeys = new Set(myRevealed.map(tileKey));
      if (revealedSeenRef.current === null) {
        revealedSeenRef.current = myRevealedKeys;
      } else {
        const fresh = myRevealed.filter(
          (position) => !revealedSeenRef.current!.has(tileKey(position)),
        );
        if (fresh.length > 0) {
          revealedSeenRef.current = myRevealedKeys;
          // Viewer-scoped by construction: redaction empties the
          // opponent's list, so only my own reveals shimmer.
          playSound("trapSense");
          pushFeed(
            fresh.length === 1
              ? [
                  `🔍 Trap sense revealed a trap at (${fresh[0].x}, ${fresh[0].y}) — it's still live!`,
                ]
              : [
                  `🔍 Trap sense revealed ${fresh.length} traps — they're still live!`,
                ],
          );
        }
      }
    },
    [pushFeed],
  );

  const poll = useCallback(async () => {
    if (!token) return;
    let res: Response;
    try {
      res = await fetch(
        `/api/games/${gameId}/state?t=${token}&version=${versionRef.current}&lastEventSeq=${lastEventSeqRef.current}`,
      );
    } catch {
      return; // network blip — the next tick retries
    }
    if (res.status === 401 || res.status === 404) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      setAuthError(
        body.error === "game-not-found"
          ? "Game not found — check the link."
          : "This link is invalid — it's missing a valid seat token.",
      );
      return;
    }
    if (!res.ok) return;
    const body = await res.json();
    versionRef.current = body.version;
    setSeat(body.seat);
    setOpponentSeenAgoSec(body.opponentSeenAgoSec);
    if (body.changed) {
      setSetupEndsAt(body.setupEndsAt ?? null);
      applyServerState(body.state, body.events ?? [], body.seat);
    }
  }, [gameId, token, applyServerState]);

  useEffect(() => {
    if (!token) return;
    poll();
    const timer = window.setInterval(poll, POLL_MS);
    return () => window.clearInterval(timer);
  }, [gameId, token, poll]);

  // Ticks the setup countdown.
  useEffect(() => {
    if (!setupEndsAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [setupEndsAt]);

  async function postAction(
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown> | null> {
    if (!token || !seat || busy) return null;
    setBusy(true);
    try {
      const res = await fetch(`/api/games/${gameId}/${path}?t=${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (res.status === 409) {
        await poll(); // raced another writer — re-sync
        return null;
      }
      if (!res.ok || data.ok !== true) {
        pushFeed([actionErrorMessage(data.error)]);
        return null;
      }
      versionRef.current = data.version as number;
      applyServerState(
        data.state as GameState,
        (data.events as NetEvent[]) ?? [],
        seat,
      );
      return data;
    } catch {
      pushFeed(["Couldn't reach the server — retrying…"]);
      return null;
    } finally {
      setBusy(false);
    }
  }

  const inSetup = netState?.phase === "setup";
  const playing = netState?.phase === "playing";
  const finished = netState?.phase === "finished";
  const inLobby = inSetup && setupEndsAt === null;
  const myTurn = playing && seat !== null && netState?.currentPlayer === seat;
  const iSubmitted =
    seat !== null &&
    netState !== null &&
    netState.pieces.some((p) => p.owner === seat);

  const palette = netState ? BIOME_PALETTES[netState.biome] : null;

  // What the board draws: my draft while placing, the filtered game state
  // otherwise. The server already hid everything I'm not meant to see.
  const displayPieces: Piece[] = useMemo(() => {
    if (!netState || !seat) return [];
    if (inSetup && !iSubmitted) {
      return ALL_CHARACTERS.filter((c) => draftPieces[c]).map((character) => ({
        id: `${seat}-${character}`,
        character,
        owner: seat,
        position: draftPieces[character]!,
        status: "active" as const,
        hasBridge: false,
        hasTrapSense: false,
      }));
    }
    return netState.pieces;
  }, [netState, seat, inSetup, iSubmitted, draftPieces]);

  const displayTraps: Trap[] = useMemo(() => {
    if (!netState || !seat) return [];
    if (inSetup && !iSubmitted) {
      return draftTraps.map((position) => ({
        owner: seat,
        position,
        triggered: false,
      }));
    }
    return netState.traps;
  }, [netState, seat, inSetup, iSubmitted, draftTraps]);

  const highlighted = useMemo(() => {
    const keys = new Set<string>();
    if (!netState || !seat) return keys;
    if (playing) {
      if (myTurn && selectedPieceId) {
        for (const target of legalStepTargets(netState, selectedPieceId)) {
          keys.add(tileKey(target));
        }
      }
      return keys;
    }
    if (!inSetup || iSubmitted) return keys;
    if (mode === "pieces") {
      const others = ALL_CHARACTERS.filter(
        (c) => c !== selectedCharacter && draftPieces[c],
      ).map((c) => draftPieces[c]!);
      for (const tile of netState.tiles) {
        if (!isInPieceZone(seat, tile.position)) continue;
        if (canPlacePieceAt(netState, seat, tile.position, others).ok) {
          keys.add(tileKey(tile.position));
        }
      }
    } else {
      for (const tile of netState.tiles) {
        if (!isInTrapZone(seat, tile.position)) continue;
        if (canPlaceTrapAt(netState, seat, tile.position, draftTraps).ok) {
          keys.add(tileKey(tile.position));
        }
      }
    }
    return keys;
  }, [
    netState,
    seat,
    playing,
    myTurn,
    selectedPieceId,
    inSetup,
    iSubmitted,
    mode,
    selectedCharacter,
    draftPieces,
    draftTraps,
  ]);

  const selectedPiece = selectedPieceId
    ? getPiece(netState!, selectedPieceId)
    : undefined;

  // Red targets for the nerf toggle — from the engine's nerfTargets over
  // the filtered view (opponent pieces are visible during play). Only
  // while armed on my turn.
  const dangerHighlighted = useMemo(() => {
    const keys = new Set<string>();
    if (netState && seat && playing && myTurn && nerfArmed) {
      for (const target of nerfTargets(netState, seat)) {
        keys.add(tileKey(target.position));
      }
    }
    return keys;
  }, [netState, seat, playing, myTurn, nerfArmed]);

  const draftPieceCount = Object.keys(draftPieces).length;
  const neutralTrapCount = draftTraps.filter((p) => p.y === NEUTRAL_ROW).length;
  const setupComplete =
    draftPieceCount === PIECES_PER_PLAYER &&
    draftTraps.length === TRAPS_PER_PLAYER;

  function handleSetupClick(position: Position) {
    if (!netState || !seat || iSubmitted) return;
    if (mode === "pieces") {
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
      const check = canPlacePieceAt(netState, seat, position, others);
      if (!check.ok) {
        pushFeed([SETUP_ERROR_MESSAGES[check.error]]);
        playSound("invalid");
        return;
      }
      const nextDraft = { ...draftPieces, [selectedCharacter]: position };
      playSound("place");
      setDraftPieces(nextDraft);
      const nextUnplaced = ALL_CHARACTERS.find((c) => !nextDraft[c]);
      if (nextUnplaced) setSelectedCharacter(nextUnplaced);
      return;
    }
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
    const check = canPlaceTrapAt(netState, seat, position, draftTraps);
    if (!check.ok) {
      pushFeed([SETUP_ERROR_MESSAGES[check.error]]);
      playSound("invalid");
      return;
    }
    playSound("place");
    setDraftTraps((prev) => [...prev, position]);
  }

  async function lockInSetup() {
    if (!seat) return;
    const pieces = ALL_CHARACTERS.map((character) => ({
      character,
      x: draftPieces[character]!.x,
      y: draftPieces[character]!.y,
    }));
    const traps = draftTraps.map((p) => ({ x: p.x, y: p.y }));
    const data = await postAction("setup", { pieces, traps });
    if (data) {
      setDraftPieces({});
      setDraftTraps([]);
      setSelectedCharacter("cat");
      setMode("pieces");
    }
  }

  /** Arm/disarm nerf targeting. Arming clears piece selection — the two
      modes share the board but never mix. */
  function toggleNerf() {
    if (!netState || !seat) return;
    if (nerfArmed) {
      setNerfArmed(false);
      return;
    }
    const targets = nerfTargets(netState, seat);
    if (targets.length === 0) {
      pushFeed([
        "No valid nerf targets — an enemy piece must stand next to one of yours.",
      ]);
      return;
    }
    setSelectedPieceId(null);
    setNerfArmed(true);
    pushFeed(["⚡ Nerf armed — tap a red-highlighted enemy piece."]);
  }

  async function handlePlayClick(position: Position) {
    if (!netState || !seat || !myTurn || busy) return;
    // Nerf targeting mode: every click is a nerf attempt on the piece
    // under the cursor (or an invalid-target error when there is none).
    if (nerfArmed) {
      const clicked = pieceAt(netState, position);
      const data = await postAction("nerf", {
        targetPieceId: clicked ? clicked.id : "",
      });
      if (data) setNerfArmed(false);
      return;
    }
    const clicked = pieceAt(netState, position);
    if (clicked && clicked.owner === seat) {
      setSelectedPieceId(clicked.id);
      return;
    }
    if (!selectedPieceId) {
      pushFeed([`Select one of your pieces first.`]);
      return;
    }
    const data = await postAction("step", {
      pieceId: selectedPieceId,
      to: position,
    });
    // Keep the selection after a plain step (so the piece can keep moving);
    // clear it when the piece left the board.
    const outcome = data?.outcome as
      | { eliminated?: boolean; scored?: boolean }
      | undefined;
    if (outcome?.eliminated || outcome?.scored) setSelectedPieceId(null);
  }

  async function copyInviteLink() {
    const link = window.localStorage.getItem(`train-invite-${gameId}`);
    if (!link) return;
    try {
      // The invite link is already absolute (built from BASE_URL server-side).
      await window.navigator.clipboard.writeText(link);
      pushFeed(["Invite link copied — send it to your opponent."]);
    } catch {
      pushFeed(["Couldn't copy — the link is on the page you created the game from."]);
    }
  }

  async function newOnlineGame() {
    setBusy(true);
    try {
      const res = await fetch("/api/games", { method: "POST" });
      const body = await res.json();
      window.localStorage.setItem(`train-invite-${body.gameId}`, body.inviteLink);
      window.location.href = body.yourLink;
    } finally {
      setBusy(false);
    }
  }

  if (authError) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center justify-center gap-4 bg-neutral-950 px-4 text-neutral-100">
        <h1 className="text-3xl font-bold">T-rain</h1>
        <p className="text-neutral-400">{authError}</p>
      </main>
    );
  }

  if (!netState || !seat || !palette) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center justify-center gap-4 bg-neutral-950 px-4 text-neutral-100">
        <h1 className="text-3xl font-bold">T-rain</h1>
        <p className="animate-pulse text-neutral-400">Connecting…</p>
      </main>
    );
  }

  const inviteLink =
    typeof window !== "undefined"
      ? window.localStorage.getItem(`train-invite-${gameId}`)
      : null;
  const setupSecondsLeft = setupEndsAt
    ? Math.max(0, Math.round((Date.parse(setupEndsAt) - now) / 1000))
    : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center gap-5 bg-neutral-950 px-4 py-10 text-neutral-100">
      <header className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">T-rain</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Online game · you are{" "}
          <span
            className="font-semibold"
            style={{ color: PLAYER_COLORS[seat] }}
          >
            {playerLabel(seat)}
          </span>
          {opponentSeenAgoSec !== null && !finished && (
            <span>
              {" "}
              · opponent{" "}
              {opponentSeenAgoSec < 15 ? (
                <span className="text-emerald-400">online</span>
              ) : (
                <span className="text-neutral-500">away</span>
              )}
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? "Unmute sounds" : "Mute sounds"}
          title={muted ? "Sounds muted" : "Sounds on"}
          className="mt-2 rounded-full bg-neutral-800 px-3 py-1.5 text-sm font-medium transition hover:bg-neutral-700"
        >
          {muted ? "🔇 Muted" : "🔊 Sound"}
        </button>
      </header>

      {inLobby && (
        <section className="flex flex-col items-center gap-3 rounded-lg bg-neutral-900 px-6 py-5 text-center">
          <p className="text-lg font-semibold">Waiting for your opponent…</p>
          {!iSubmitted && (
            <p className="max-w-md text-sm text-neutral-400">
              Your opponent hasn&apos;t joined yet — you can place your
              pieces and traps below now, at your own pace. The 120-second
              setup clock only starts when they arrive.
            </p>
          )}
          {inviteLink ? (
            <>
              <p className="max-w-md text-sm text-neutral-400">
                Share this link — it won&apos;t be shown again:
              </p>
              <code className="max-w-full break-all rounded bg-neutral-800 px-3 py-2 font-mono text-xs">
                {inviteLink}
              </code>
              <button
                type="button"
                onClick={copyInviteLink}
                className="rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-500"
              >
                📋 Copy invite link
              </button>
            </>
          ) : (
            <p className="max-w-md text-sm text-neutral-400">
              The invite link was shown when this game was created. Ask the
              host to send it again.
            </p>
          )}
        </section>
      )}

      {inSetup && !iSubmitted && (
        <>
          <p className="text-center text-sm text-neutral-300">
            Place {PIECES_PER_PLAYER} pieces in your back 3 rows, then{" "}
            {TRAPS_PER_PLAYER} traps in your zone + the neutral row (max{" "}
            {MAX_NEUTRAL_TRAPS} neutral). Legal tiles are outlined white. 🎁
            is a mystery box: yours waits in the enemy zone, and a trap
            can&apos;t sit on one.
            {setupSecondsLeft !== null && (
              <>
                {" "}
                <span className="font-mono font-semibold">
                  {Math.floor(setupSecondsLeft / 60)}:
                  {String(setupSecondsLeft % 60).padStart(2, "0")}
                </span>{" "}
                left — then the server auto-places.
              </>
            )}
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

      {inSetup && iSubmitted && !finished && (
        <p className="text-center text-sm text-neutral-300">
          🔒 Your setup is locked in — waiting for{" "}
          {playerLabel(seat === "south" ? "north" : "south")}…
        </p>
      )}

      <Board
        tiles={netState.tiles}
        biome={netState.biome}
        pieces={displayPieces}
        traps={displayTraps}
        revealedTrapKeys={
          seat
            ? finished
              ? // Post-game reveal: the opponent's traps that were
                // hidden all game (the server stops filtering traps
                // once the game is finished).
                new Set(
                  netState.traps
                    .filter((t) => t.owner !== seat && !t.triggered)
                    .map((t) => tileKey(t.position)),
                )
              : new Set(netState.revealedTraps[seat].map(tileKey))
            : undefined
        }
        nerfMarkers={netState.nerfMarkers}
        postGame={finished}
        mysteryBoxes={netState.mysteryBoxes}
        highlighted={highlighted}
        dangerHighlighted={dangerHighlighted}
        piecesKey={gameId}
        selectedKey={
          playing && myTurn && selectedPiece
            ? tileKey(selectedPiece.position)
            : undefined
        }
        onTileClick={
          finished || busy
            ? undefined
            : playing
              ? handlePlayClick
              : inSetup && !iSubmitted
                ? handleSetupClick
                : undefined
        }
      />

      {inSetup && !iSubmitted && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              setDraftPieces({});
              setDraftTraps([]);
            }}
            className="rounded-full bg-neutral-800 px-4 py-1.5 text-sm transition hover:bg-neutral-700"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={lockInSetup}
            disabled={!setupComplete || busy}
            className="rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Lock in my setup
          </button>
        </div>
      )}

      {(playing || finished) && (
        <section className="flex flex-col items-center gap-3 text-center">
          <p className="text-lg">
            <span style={{ color: PLAYER_COLORS.north }} className="font-bold">
              North {netState.scores.north}
            </span>
            <span className="text-neutral-500"> / {PIECES_TO_WIN} · </span>
            <span style={{ color: PLAYER_COLORS.south }} className="font-bold">
              South {netState.scores.south}
            </span>
            <span className="text-neutral-500"> / {PIECES_TO_WIN}</span>
          </p>

          {finished ? (
            <>
              <p className="text-2xl font-bold">
                🏆{" "}
                <span
                  style={{
                    color: netState.winner
                      ? PLAYER_COLORS[netState.winner]
                      : undefined,
                  }}
                >
                  {netState.winner ? playerLabel(netState.winner) : ""}
                </span>{" "}
                wins the game!
              </p>
              <p className="max-w-md text-sm text-neutral-400">
                Every hidden trap is now revealed on the board —{" "}
                {playerLabel("north")} had{" "}
                {
                  netState.traps.filter(
                    (t) => t.owner === "north" && !t.triggered,
                  ).length
                }{" "}
                that never fired, {playerLabel("south")} had{" "}
                {
                  netState.traps.filter(
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
                    <span>🎉 {netState.scores[player]} crossed</span>
                    <span>
                      💥{" "}
                      {
                        netState.pieces.filter(
                          (p) =>
                            p.owner === player && p.status === "eliminated",
                        ).length
                      }{" "}
                      eliminated
                    </span>
                    <span>
                      🐾{" "}
                      {
                        netState.pieces.filter(
                          (p) => p.owner === player && p.status === "active",
                        ).length
                      }{" "}
                      still on the board
                    </span>
                    <span>
                      🪤{" "}
                      {
                        netState.traps.filter(
                          (t) => t.owner === player && t.triggered,
                        ).length
                      }{" "}
                      traps fired
                    </span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={newOnlineGame}
                disabled={busy}
                className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-40"
              >
                🔄 Rematch — new online game
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-neutral-300">
                <span
                  className="font-semibold"
                  style={{ color: PLAYER_COLORS[netState.currentPlayer] }}
                >
                  {playerLabel(netState.currentPlayer)}
                </span>{" "}
                to move · Movement points:{" "}
                <span className="font-mono font-semibold">
                  {netState.movementPointsLeft}/{MOVEMENT_POINTS_PER_TURN}
                </span>
                {" "}· ⚡{" "}
                <span
                  className="font-mono font-semibold"
                  title="Nerf tokens — earn one per crossing (usable next turn); a nerf costs 1 token + 3 pool points"
                >
                  {netState.nerfTokens[seat]}/{NERF_TOKEN_CAP}
                </span>
                {myTurn && selectedPiece && (
                  <>
                    {" "}
                    · {CHARACTERS[selectedPiece.character].emoji}{" "}
                    {CHARACTERS[selectedPiece.character].label} selected, spent{" "}
                    {netState.spentThisTurn[selectedPiece.id] ?? 0}/
                    {MAX_POINTS_PER_PIECE_PER_TURN}
                    {(netState.bonusPoints[selectedPiece.id] ?? 0) > 0 && (
                      <> + {netState.bonusPoints[selectedPiece.id]}🎁 free</>
                    )}
                    {selectedPiece.hasTrapSense && <> · 🔍 trap sense</>}
                  </>
                )}
              </p>
              {myTurn ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPieceId(null);
                      setNerfArmed(false);
                      postAction("end-turn");
                    }}
                    disabled={busy}
                    className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-40"
                  >
                    End turn ⏭
                  </button>
                  <button
                    type="button"
                    onClick={toggleNerf}
                    disabled={
                      busy ||
                      netState.nerfTokens[seat] < 1 ||
                      netState.movementPointsLeft < NERF_POOL_COST
                    }
                    className={`rounded-full px-5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      nerfArmed
                        ? "bg-red-600 text-white hover:bg-red-500"
                        : "bg-neutral-800 hover:bg-neutral-700"
                    }`}
                  >
                    {nerfArmed ? "⚡ Cancel nerf" : "⚡ Nerf"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (forfeitArmed) {
                        setForfeitArmed(false);
                        setNerfArmed(false);
                        postAction("forfeit");
                      } else {
                        setForfeitArmed(true);
                        window.setTimeout(() => setForfeitArmed(false), 4000);
                      }
                    }}
                    disabled={busy}
                    className="rounded-full bg-neutral-800 px-5 py-2 text-sm transition hover:bg-neutral-700 disabled:opacity-40"
                  >
                    {forfeitArmed ? "Tap again to forfeit" : "Forfeit"}
                  </button>
                </div>
              ) : (
                <p className="animate-pulse text-sm text-neutral-400">
                  Waiting for {playerLabel(netState.currentPlayer)}…
                </p>
              )}
            </>
          )}
        </section>
      )}

      {feed.length > 0 && (
        <section className="flex w-full max-w-xl flex-col gap-1 rounded-lg bg-neutral-900 px-4 py-3 text-sm">
          {feed.map((line, i) => (
            <p
              key={`${i}-${line.slice(0, 12)}`}
              className={i === feed.length - 1 ? "text-neutral-100" : "text-neutral-500"}
            >
              {line}
            </p>
          ))}
        </section>
      )}

      {!finished && (
        <p className="text-xs text-neutral-500">
          Polling the server every 2s · your moves are confirmed by the server,
          not predicted locally.
        </p>
      )}
    </main>
  );
}

export default function GamePage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center justify-center bg-neutral-950 text-neutral-100">
          <p className="animate-pulse text-neutral-400">Loading…</p>
        </main>
      }
    >
      <GameClient />
    </Suspense>
  );
}
