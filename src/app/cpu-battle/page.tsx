"use client";

// The CPU battle lab: watch two CPU strategies play each other, run
// tournaments, and download every game as JSONL for later algo tuning.
//
// Watch mode reuses the same battle driver as the headless runner —
// createBattle / battleStep / finalizeBattle — so what you watch and what
// a tournament logs are the same code path, not two implementations that
// can drift apart.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import Board from "@/components/Board";
import { PIECES_TO_WIN } from "@/lib/game/constants";
import { BIOME_PALETTES } from "@/lib/game/palettes";
import type { GameState, PlayerId } from "@/lib/game/types";
import {
  battleStep,
  createBattle,
  finalizeBattle,
  runBattleGame,
  type BattleDriver,
} from "@/lib/battle/runner";
import { CPU_STRATEGIES } from "@/lib/battle/strategies";

type Status = "idle" | "running" | "paused" | "finished";
type Speed = "watch" | "fast" | "instant";

const STEP_DELAY_MS: Record<Exclude<Speed, "instant">, number> = {
  watch: 350,
  fast: 40,
};

const FEED_LINES = 12;
const MAX_TOURNAMENT_GAMES = 500;

function download(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/jsonl" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function playerLabel(player: PlayerId): string {
  return player === "south" ? "South" : "North";
}

export default function CpuBattlePage() {
  const [southId, setSouthId] = useState("full");
  const [northId, setNorthId] = useState("pathfinder");
  const [speed, setSpeed] = useState<Speed>("watch");
  const [status, setStatus] = useState<Status>("idle");
  const [game, setGame] = useState<GameState | null>(null);
  const [gameId, setGameId] = useState("");
  const [versions, setVersions] = useState<{ south: string; north: string }>({
    south: "",
    north: "",
  });
  const [turns, setTurns] = useState(0);
  const [actions, setActions] = useState(0);
  const [feed, setFeed] = useState<string[]>([]);
  const [sessionGames, setSessionGames] = useState(0);
  const [sessionWins, setSessionWins] = useState<Record<string, number>>({});
  const [sessionLogs, setSessionLogs] = useState<string[]>([]);
  const [tourneyN, setTourneyN] = useState(20);
  const [tourneyRunning, setTourneyRunning] = useState(false);
  const [tourneyProgress, setTourneyProgress] = useState(0);
  const [tourneyResults, setTourneyResults] = useState<{
    games: number;
    wins: Record<string, number>;
    draws: number;
    avgTurns: number;
    avgActions: number;
  } | null>(null);
  const [tourneyLogs, setTourneyLogs] = useState<string[]>([]);

  const driverRef = useRef<BattleDriver | null>(null);

  function pushFeed(lines: string[]): void {
    if (lines.length === 0) return;
    setFeed((prev) => [...prev, ...lines].slice(-FEED_LINES));
  }

  function finishBattle(): void {
    const driver = driverRef.current;
    if (!driver) return;
    const result = finalizeBattle(driver);
    const winnerVersion = result.finalState.winner
      ? driver.strategies[result.finalState.winner].version
      : "draw";
    setSessionGames((n) => n + 1);
    setSessionWins((prev) => ({
      ...prev,
      [winnerVersion]: (prev[winnerVersion] ?? 0) + 1,
    }));
    setSessionLogs((prev) => [...prev, result.log.toJSONL()]);
    setStatus("finished");
  }

  function startBattle(rematch: boolean): void {
    const seed = Math.floor(Math.random() * 1_000_000);
    const id = `battle-${seed}`;
    const driver = createBattle(seed, southId, northId, { gameId: id });
    driverRef.current = driver;
    setGameId(id);
    setVersions({
      south: driver.strategies.south.version,
      north: driver.strategies.north.version,
    });
    setGame(driver.state);
    setTurns(0);
    setActions(0);
    setFeed(rematch ? [`🔄 Rematch: ${southId} (South) vs ${northId} (North), seed ${seed}.`] : [`⚔️ ${southId} (South) vs ${northId} (North), seed ${seed}.`]);

    if (speed === "instant") {
      while (!driver.finished) battleStep(driver);
      setGame({ ...driver.state });
      setTurns(driver.turns);
      setActions(driver.actions);
      finishBattle();
      return;
    }
    setStatus("running");
  }

  // Watch/fast mode: one battleStep per tick, re-rendering between them.
  // The effect re-subscribes on every status/speed/game change, so the
  // closure always sees fresh values — no refs needed.
  useEffect(() => {
    if (status !== "running" || speed === "instant") return;
    const driver = driverRef.current;
    if (!driver) return;
    const timer = window.setTimeout(() => {
      const { narrations, done } = battleStep(driver);
      setGame({ ...driver.state });
      setTurns(driver.turns);
      setActions(driver.actions);
      pushFeed(narrations);
      if (done) finishBattle();
    }, STEP_DELAY_MS[speed]);
    return () => window.clearTimeout(timer);
  }, [status, speed, game]);

  function togglePause(): void {
    setStatus((s) => (s === "running" ? "paused" : s === "paused" ? "running" : s));
  }

  function resetAll(): void {
    driverRef.current = null;
    setGame(null);
    setGameId("");
    setTurns(0);
    setActions(0);
    setFeed([]);
    setStatus("idle");
  }

  async function runTournament(): Promise<void> {
    const n = Math.max(1, Math.min(MAX_TOURNAMENT_GAMES, Math.floor(tourneyN) || 1));
    setTourneyN(n);
    setTourneyRunning(true);
    setTourneyProgress(0);
    setTourneyResults(null);
    const baseSeed = Math.floor(Math.random() * 1_000_000);
    const wins: Record<string, number> = {};
    let draws = 0;
    let totalTurns = 0;
    let totalActions = 0;
    const logs: string[] = [];
    for (let i = 0; i < n; i++) {
      const result = runBattleGame(baseSeed + i, southId, northId, {
        gameId: `tourney-${baseSeed}-${i}`,
      });
      const startEvent = result.log.all.find((e) => e.type === "game_start");
      if (result.finalState.winner && startEvent) {
        const v = startEvent.strategies[result.finalState.winner];
        wins[v] = (wins[v] ?? 0) + 1;
      } else {
        draws++;
      }
      totalTurns += result.turns;
      totalActions += result.actions;
      logs.push(result.log.toJSONL());
      setTourneyProgress(i + 1);
      // Yield so the progress bar paints and the tab stays alive.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    setTourneyLogs(logs);
    setTourneyResults({
      games: n,
      wins,
      draws,
      avgTurns: totalTurns / n,
      avgActions: totalActions / n,
    });
    setTourneyRunning(false);
  }

  const finished = status === "finished" && game?.phase === "finished";
  const winnerLabel = finished && game.winner ? versions[game.winner] : null;
  const winReason =
    finished && game.winner
      ? game.scores[game.winner] >= PIECES_TO_WIN
        ? `first to ${PIECES_TO_WIN}`
        : "attrition"
      : null;
  const palette = game ? BIOME_PALETTES[game.biome] : null;
  const busy = status === "running" || status === "paused";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center gap-5 bg-neutral-950 px-4 py-10 text-neutral-100">
      <header className="text-center">
        <Link
          href="/"
          className="mb-2 inline-block text-sm text-neutral-500 transition hover:text-neutral-300"
        >
          ← Home
        </Link>
        <h1 className="text-4xl font-bold tracking-tight">CPU Battle Lab</h1>
        <p className="mt-1 max-w-xl text-sm text-neutral-400">
          Two CPU strategies play each other — watch it live, or run a
          tournament and download every game as JSONL for algo tuning.
        </p>
      </header>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-sky-300">South</span>
          <select
            value={southId}
            onChange={(e) => setSouthId(e.target.value)}
            disabled={busy}
            className="rounded-full bg-neutral-800 px-3 py-1.5 text-sm disabled:opacity-40"
          >
            {CPU_STRATEGIES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <span className="text-neutral-500">vs</span>
        <label className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-red-300">North</span>
          <select
            value={northId}
            onChange={(e) => setNorthId(e.target.value)}
            disabled={busy}
            className="rounded-full bg-neutral-800 px-3 py-1.5 text-sm disabled:opacity-40"
          >
            {CPU_STRATEGIES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-neutral-400">
          Speed
          <select
            value={speed}
            onChange={(e) => setSpeed(e.target.value as Speed)}
            disabled={busy}
            className="rounded-full bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 disabled:opacity-40"
          >
            <option value="watch">Watch</option>
            <option value="fast">Fast</option>
            <option value="instant">Instant</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => startBattle(false)}
          disabled={busy}
          className="rounded-full bg-emerald-600 px-5 py-1.5 text-sm font-semibold transition hover:bg-emerald-500 disabled:opacity-40"
        >
          ▶ Start
        </button>
        <button
          type="button"
          onClick={togglePause}
          disabled={!busy}
          className="rounded-full bg-neutral-700 px-5 py-1.5 text-sm font-semibold transition hover:bg-neutral-600 disabled:opacity-40"
        >
          {status === "paused" ? "▶ Resume" : "⏸ Pause"}
        </button>
        <button
          type="button"
          onClick={resetAll}
          className="rounded-full bg-neutral-700 px-5 py-1.5 text-sm font-semibold transition hover:bg-neutral-600"
        >
          ↺ Reset
        </button>
        <button
          type="button"
          onClick={() => startBattle(true)}
          disabled={busy}
          className="rounded-full bg-neutral-700 px-5 py-1.5 text-sm font-semibold transition hover:bg-neutral-600 disabled:opacity-40"
        >
          🔄 Rematch
        </button>
      </div>

      {/* Scoreboard */}
      {game && (
        <div className="flex w-full max-w-3xl flex-wrap items-stretch justify-center gap-3">
          {(["south", "north"] as PlayerId[]).map((player) => (
            <div
              key={player}
              className={`flex-1 rounded-xl px-4 py-3 text-center ${
                game.currentPlayer === player && !finished
                  ? "bg-neutral-800 ring-1 ring-neutral-600"
                  : "bg-neutral-900"
              }`}
            >
              <p
                className={`text-sm font-semibold ${player === "south" ? "text-sky-300" : "text-red-300"}`}
              >
                {playerLabel(player)} · {versions[player]}
              </p>
              <p className="mt-1 text-2xl font-bold">
                {game.scores[player]}
                <span className="text-sm font-normal text-neutral-500">
                  /{PIECES_TO_WIN}
                </span>
              </p>
            </div>
          ))}
          <div className="flex items-center gap-4 rounded-xl bg-neutral-900 px-4 py-3 text-sm text-neutral-400">
            <span>
              Turn <span className="font-mono font-semibold text-neutral-200">{turns}</span>
            </span>
            <span>
              Actions <span className="font-mono font-semibold text-neutral-200">{actions}</span>
            </span>
            {status === "running" && (
              <span className="text-neutral-500">🤔 thinking…</span>
            )}
          </div>
        </div>
      )}

      {finished && winnerLabel && (
        <p className="rounded-full bg-emerald-900 px-5 py-2 text-sm font-semibold text-emerald-200">
          🏆 {winnerLabel} wins ({winReason})
        </p>
      )}

      {/* Board */}
      {game && palette && (
        <div className="w-full max-w-3xl">
          <Board
            tiles={game.tiles}
            biome={game.biome}
            pieces={game.pieces}
            traps={game.traps}
            piecesKey={gameId}
          />
          <p className="mt-1 text-center text-xs text-neutral-600">
            Seed {game.seed} · {palette.label} biome · spectator view (all traps
            shown)
          </p>
        </div>
      )}

      {/* Event feed + downloads */}
      {game && (
        <div className="w-full max-w-3xl rounded-xl bg-neutral-900 px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-300">Event feed</h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  driverRef.current &&
                  download(`${gameId}.jsonl`, driverRef.current.log.toJSONL())
                }
                disabled={!game}
                className="rounded-full bg-neutral-700 px-3 py-1 text-xs transition hover:bg-neutral-600 disabled:opacity-40"
              >
                ⬇ This game (.jsonl)
              </button>
              <button
                type="button"
                onClick={() =>
                  download(
                    `t-rain-battles-${Date.now()}.jsonl`,
                    sessionLogs.join("\n"),
                  )
                }
                disabled={sessionLogs.length === 0}
                className="rounded-full bg-neutral-700 px-3 py-1 text-xs transition hover:bg-neutral-600 disabled:opacity-40"
              >
                ⬇ Session ({sessionLogs.length} games)
              </button>
            </div>
          </div>
          <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto font-mono text-xs text-neutral-400">
            {feed.length === 0 && (
              <li className="text-neutral-600">No events yet.</li>
            )}
            {feed.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Session tally */}
      {sessionGames > 0 && (
        <p className="text-sm text-neutral-400">
          Session: {sessionGames} game{sessionGames === 1 ? "" : "s"} ·{" "}
          {Object.entries(sessionWins)
            .map(([v, w]) => `${v}: ${w}`)
            .join(" · ")}
        </p>
      )}

      {/* Tournament */}
      <section className="w-full max-w-3xl rounded-xl bg-neutral-900 px-4 py-4">
        <h2 className="text-sm font-semibold text-neutral-300">
          Tournament — same matchup, many games
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          Runs headless (no animation) with fresh seeds. Results below are
          win rates, not vibes.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            Games
            <input
              type="number"
              min={1}
              max={MAX_TOURNAMENT_GAMES}
              value={tourneyN}
              onChange={(e) => setTourneyN(Number(e.target.value))}
              disabled={tourneyRunning || busy}
              className="w-20 rounded-full bg-neutral-800 px-3 py-1.5 text-sm disabled:opacity-40"
            />
          </label>
          <button
            type="button"
            onClick={runTournament}
            disabled={tourneyRunning || busy}
            className="rounded-full bg-emerald-600 px-5 py-1.5 text-sm font-semibold transition hover:bg-emerald-500 disabled:opacity-40"
          >
            {tourneyRunning ? "Running…" : "Run tournament"}
          </button>
          {tourneyRunning && (
            <span className="text-sm text-neutral-400">
              {tourneyProgress}/{tourneyN}…
            </span>
          )}
          {tourneyLogs.length > 0 && !tourneyRunning && (
            <button
              type="button"
              onClick={() =>
                download(
                  `t-rain-tournament-${Date.now()}.jsonl`,
                  tourneyLogs.join("\n"),
                )
              }
              className="rounded-full bg-neutral-700 px-4 py-1.5 text-sm transition hover:bg-neutral-600"
            >
              ⬇ Tournament logs ({tourneyLogs.length} games)
            </button>
          )}
        </div>
        {tourneyResults && (
          <div className="mt-3 rounded-lg bg-neutral-800 px-4 py-3 text-sm">
            <p className="font-semibold">
              {tourneyResults.games} games
              {tourneyResults.draws > 0 &&
                ` · ${tourneyResults.draws} draws (turn cap)`}
            </p>
            <ul className="mt-1 text-neutral-300">
              {Object.entries(tourneyResults.wins).map(([v, w]) => (
                <li key={v}>
                  {v}: {w} wins (
                  {((w / tourneyResults.games) * 100).toFixed(1)}%)
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-neutral-500">
              Avg {tourneyResults.avgTurns.toFixed(1)} turns ·{" "}
              {tourneyResults.avgActions.toFixed(0)} actions per game
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
