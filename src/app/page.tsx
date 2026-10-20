"use client";

// The T-rain landing page: pick a local game (vs CPU or hotseat, on this
// device) or an online game (human vs human, across browsers).

import { useState } from "react";
import Link from "next/link";

import { PIECES_TO_WIN } from "@/lib/game/constants";

export default function LandingPage() {
  // Creating an online game hands back two bearer-token links — yours,
  // and one to share with your opponent.
  const [creating, setCreating] = useState(false);
  const [onlineGame, setOnlineGame] = useState<{
    gameId: string;
    yourLink: string;
    inviteLink: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createOnlineGame() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/games", { method: "POST" });
      if (!res.ok) {
        setError("Couldn't create the online game — try again.");
        return;
      }
      const body = await res.json();
      window.localStorage.setItem(
        `train-invite-${body.gameId}`,
        body.inviteLink,
      );
      setOnlineGame(body);
      setCopied(false);
    } finally {
      setCreating(false);
    }
  }

  async function copyInviteLink() {
    if (!onlineGame) return;
    try {
      // The invite link is already absolute (built from BASE_URL server-side).
      await window.navigator.clipboard.writeText(onlineGame.inviteLink);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center gap-8 bg-neutral-950 px-4 py-10 text-neutral-100">
      <header className="text-center">
        <h1 className="text-5xl font-bold tracking-tight">T-rain</h1>
        <p className="mt-3 max-w-xl text-neutral-400">
          A turn-based tactics game on shifting terrain. Guide{" "}
          {PIECES_TO_WIN} of your 15 creatures across the board before your
          opponent does — and mind the hidden traps.
        </p>
      </header>

      <div className="grid w-full gap-4 sm:grid-cols-3">
        <section className="flex flex-col items-center gap-3 rounded-xl bg-neutral-900 px-6 py-6 text-center">
          <p className="text-3xl">🖥️</p>
          <h2 className="text-xl font-semibold">Local game</h2>
          <p className="text-sm text-neutral-400">
            Play against the CPU or a friend on this device.
          </p>
          <Link
            href="/local"
            className="mt-1 rounded-full bg-emerald-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500"
          >
            Play local →
          </Link>
        </section>

        <section className="flex flex-col items-center gap-3 rounded-xl bg-neutral-900 px-6 py-6 text-center">
          <p className="text-3xl">🤖</p>
          <h2 className="text-xl font-semibold">CPU battle lab</h2>
          <p className="text-sm text-neutral-400">
            Watch CPU strategies play each other, run tournaments, and
            download JSONL logs for tuning.
          </p>
          <Link
            href="/cpu-battle"
            className="mt-1 rounded-full bg-emerald-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500"
          >
            Open the lab →
          </Link>
        </section>

        <section className="flex flex-col items-center gap-3 rounded-xl bg-neutral-900 px-6 py-6 text-center">
          <p className="text-3xl">🌐</p>
          <h2 className="text-xl font-semibold">Online game</h2>
          <p className="text-sm text-neutral-400">
            Human vs human, in two browsers. The server holds the game; your
            opponent&apos;s traps stay hidden.
          </p>
          {!onlineGame ? (
            <button
              type="button"
              onClick={createOnlineGame}
              disabled={creating}
              className="mt-1 rounded-full bg-emerald-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-40"
            >
              {creating ? "Creating…" : "Create online game"}
            </button>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-neutral-400">
                Game created! Send this link to your opponent — it won&apos;t
                be shown again:
              </p>
              <code className="max-w-full break-all rounded bg-neutral-800 px-3 py-2 font-mono text-xs">
                {onlineGame.inviteLink}
              </code>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={copyInviteLink}
                  className="rounded-full bg-neutral-700 px-4 py-1.5 text-sm transition hover:bg-neutral-600"
                >
                  {copied ? "✓ Copied" : "📋 Copy invite link"}
                </button>
                <a
                  href={onlineGame.yourLink}
                  className="rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-500"
                >
                  Enter as South →
                </a>
              </div>
            </div>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </section>
      </div>

      <p className="text-center text-sm">
        <Link
          href="/rules"
          className="text-emerald-400 transition hover:text-emerald-300"
        >
          📖 New to T-rain? Read how to play →
        </Link>
      </p>

      <p className="text-center text-xs text-neutral-600">
        15 creatures each · 10 hidden traps each · 10 movement points a turn ·
        first to {PIECES_TO_WIN} across wins
      </p>
    </main>
  );
}
