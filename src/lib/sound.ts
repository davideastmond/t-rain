// Game sound effects, synthesized with the Web Audio API — no audio
// files, no licensing, nothing to download (SOUND_SPEC.md).
//
// Everything here is inert until the first user gesture: browsers block
// audio before interaction, so the AudioContext is created lazily and
// resumed inside play() — which always runs inside a click handler or
// a timer the player started. Before that, play() is a silent no-op.
// The module never touches `window` at import time, so server-side
// prerendering is safe.
//
// Sounds are data, not recordings: each recipe is an oscillator type,
// a frequency sweep, a duration and a volume. Tune by ear by editing
// the numbers below. A sound must never be the only carrier of
// information — every one duplicates something already shown visually.

import type { StepOutcome } from "./game/movement";
import type { GameState, PlayerId } from "./game/types";
import type { NetEvent } from "./net/store";

export type SoundName =
  | "move"
  | "trap"
  | "nerf"
  | "box"
  | "trapSense"
  | "score"
  | "win"
  | "lose"
  | "drown"
  | "invalid"
  | "turn"
  | "place"
  | "start"
  | "bonus"
  | "bridge";

const MUTE_KEY = "train-muted";

/** One sound per step, in priority order: a step that scores *and*
    collects plays the box chime, not two sounds at once. A booby-trap
    collection is an elimination first, so it plays the trap sound. */
export function soundForStepOutcome(outcome: StepOutcome): SoundName {
  if (outcome.eliminated) return "trap";
  if (outcome.box) return "box";
  if (outcome.scored) return "score";
  return "move";
}

export interface QueuedSound {
  name: SoundName;
  /** Opponent-side events play quieter, so an online game sounds alive
      without doubling your own actions. */
  soft: boolean;
  delayMs: number;
}

/**
 * Map a batch of new net events to the sounds they should play, in
 * seq order. The rule for volume: an event sounds full when it
 * concerns your own pieces, soft when it concerns the opponent's.
 *
 * A step covered by a terminal event in the same batch (trap, score,
 * or box) plays no move sound — the terminal sound covers it, the
 * same one-sound-per-step rule as local play. Boxes are never on the
 * goal row, so a step can't both collect and score. The trap-sense
 * shimmer is NOT here: reveals are derived client-side from the
 * viewer's own redacted state (see the net page), never from events.
 * `game-created`, `player-joined`, `setup-submitted`, and `forfeited`
 * are silent — a forfeit is covered by the game-finished stinger that
 * follows it.
 */
export function netEventSounds(
  events: NetEvent[],
  state: GameState,
  seat: PlayerId | null,
): QueuedSound[] {
  if (seat === null) return [];
  const terminalPieces = new Set<string>();
  for (const event of events) {
    if (event.type === "trap-triggered") {
      terminalPieces.add(event.victimPieceId);
    } else if (event.type === "scored" || event.type === "box-collected") {
      terminalPieces.add(event.pieceId);
    }
  }
  const ownerOf = (pieceId: string): PlayerId | null =>
    state.pieces.find((p) => p.id === pieceId)?.owner ?? null;
  const out: QueuedSound[] = [];
  for (const event of events) {
    switch (event.type) {
      case "step":
        if (!terminalPieces.has(event.pieceId)) {
          out.push({
            name: "move",
            soft: ownerOf(event.pieceId) !== seat,
            delayMs: 0,
          });
        }
        break;
      case "trap-triggered":
        out.push({
          name: "trap",
          soft: ownerOf(event.victimPieceId) !== seat,
          delayMs: 0,
        });
        break;
      case "scored":
        out.push({ name: "score", soft: event.player !== seat, delayMs: 0 });
        break;
      case "nerfed":
        out.push({
          name: "nerf",
          soft: ownerOf(event.targetPieceId) !== seat,
          delayMs: 0,
        });
        break;
      case "box-collected": {
        const soft = event.player !== seat;
        if (event.outcome === "booby-trap") {
          out.push({ name: "trap", soft, delayMs: 0 });
        } else {
          out.push({ name: "box", soft, delayMs: 0 });
          // Per-outcome tails, matching local play. Trap sense's tail
          // is the shimmer, which the net page plays from its own
          // viewer-scoped reveal diff — never from the event.
          if (event.outcome === "extra-steps") {
            out.push({ name: "bonus", soft, delayMs: 180 });
          } else if (event.outcome === "bridge") {
            out.push({ name: "bridge", soft, delayMs: 180 });
          }
        }
        break;
      }
      case "piece-drowned":
        out.push({ name: "drown", soft: event.player !== seat, delayMs: 0 });
        break;
      case "turn-ended":
        // The opponent ended their turn: yours just started.
        if (event.player !== seat) {
          out.push({ name: "turn", soft: false, delayMs: 0 });
        }
        break;
      case "game-finished":
        out.push({
          name: event.winner === seat ? "win" : "lose",
          soft: false,
          delayMs: 300,
        });
        break;
      default:
        break;
    }
  }
  return out;
}

export function playNetEventSounds(
  events: NetEvent[],
  state: GameState,
  seat: PlayerId | null,
): void {
  for (const sound of netEventSounds(events, state, seat)) {
    if (sound.delayMs > 0) {
      const { name, soft } = sound;
      globalThis.setTimeout(() => playSound(name, soft), sound.delayMs);
    } else {
      playSound(sound.name, sound.soft);
    }
  }
}

/** Base sound for a step, plus the trap-sense shimmer whenever the step
    revealed traps. Callers must only use this for the *viewing*
    player's own steps — the CPU's reveals are private (PR #43), so CPU
    steps play `soundForStepOutcome` alone, never the shimmer.
    Box collections also get a delayed tail per outcome (extra-steps
    sparkles, bridge thuds); trap sense's tail IS the shimmer, and
    booby gets none — the trap sound already says it. */
export function playStepSounds(outcome: StepOutcome): void {
  playSound(soundForStepOutcome(outcome));
  if (outcome.revealed.length > 0) playSound("trapSense");
  if (outcome.box === "extra-steps") {
    globalThis.setTimeout(() => playSound("bonus"), 180);
  } else if (outcome.box === "bridge") {
    globalThis.setTimeout(() => playSound("bridge"), 180);
  }
}

let ctx: AudioContext | null = null;
let mutedCache: boolean | null = null;

export function isMuted(): boolean {
  if (mutedCache !== null) return mutedCache;
  if (typeof window === "undefined") return false;
  try {
    mutedCache = window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    mutedCache = false;
  }
  return mutedCache;
}

type MutedListener = () => void;
const mutedListeners = new Set<MutedListener>();

/** Subscribe to mute changes (same-tab writes don't fire the
    `storage` event, so `setMuted` notifies directly). Pairs with
    `useSyncExternalStore` in the UI. */
export function subscribeMuted(listener: MutedListener): () => void {
  mutedListeners.add(listener);
  return () => {
    mutedListeners.delete(listener);
  };
}

export function setMuted(muted: boolean): void {
  mutedCache = muted;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // Private mode or blocked storage: sound just stays on.
  }
  for (const listener of mutedListeners) listener();
}

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

interface ToneOptions {
  type: OscillatorType;
  from: number;
  to: number;
  /** Seconds after "now" to start. */
  at?: number;
  dur: number;
  vol: number;
  detunePct?: number;
  /** Volume multiplier (0.6 for soft/opponent-side sounds). */
  scale?: number;
}

function tone(ac: AudioContext, opts: ToneOptions): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  const t0 = ac.currentTime + (opts.at ?? 0);
  const detune = opts.detunePct
    ? 1 + (Math.random() * 2 - 1) * opts.detunePct
    : 1;
  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.from * detune, t0);
  osc.frequency.exponentialRampToValueAtTime(
    Math.max(1, opts.to * detune),
    t0 + opts.dur,
  );
  gain.gain.setValueAtTime(opts.vol * (opts.scale ?? 1), t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + opts.dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + opts.dur + 0.02);
}

function noise(
  ac: AudioContext,
  dur: number,
  vol: number,
  cutoff: number,
  scale = 1,
): void {
  const length = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buffer = ac.createBuffer(1, length, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    // Fade out over the burst so it doesn't click at the end.
    data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  }
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(cutoff, ac.currentTime);
  filter.frequency.exponentialRampToValueAtTime(
    Math.max(40, cutoff / 4),
    ac.currentTime + dur,
  );
  const gain = ac.createGain();
  gain.gain.setValueAtTime(vol * scale, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
  src.connect(filter).connect(gain).connect(ac.destination);
  src.start();
}

function note(
  ac: AudioContext,
  freq: number,
  at: number,
  dur: number,
  vol: number,
  scale = 1,
): void {
  tone(ac, { type: "sine", from: freq, to: freq, at, dur, vol, scale });
}

export function playSound(name: SoundName, soft = false): void {
  if (isMuted()) return;
  const ac = getContext();
  if (!ac) return;
  const scale = soft ? 0.6 : 1;
  try {
    switch (name) {
      case "move":
        // Quiet blip, slightly detuned each time so repeated steps
        // don't sound mechanical.
        tone(ac, {
          type: "triangle",
          from: 320,
          to: 220,
          dur: 0.08,
          vol: 0.12,
          detunePct: 0.1,
          scale,
        });
        break;
      case "trap":
        noise(ac, 0.2, 0.25, 1200, scale);
        tone(ac, {
          type: "square",
          from: 220,
          to: 60,
          dur: 0.2,
          vol: 0.18,
          scale,
        });
        break;
      case "nerf":
        tone(ac, {
          type: "sawtooth",
          from: 900,
          to: 150,
          dur: 0.15,
          vol: 0.2,
          scale,
        });
        break;
      case "box":
        note(ac, 523.25, 0, 0.09, 0.18, scale);
        note(ac, 659.25, 0.06, 0.09, 0.18, scale);
        note(ac, 783.99, 0.12, 0.12, 0.18, scale);
        break;
      case "trapSense":
        tone(ac, {
          type: "sine",
          from: 1200,
          to: 1800,
          dur: 0.15,
          vol: 0.1,
          scale,
        });
        break;
      case "score":
        note(ac, 659.25, 0, 0.12, 0.2, scale);
        note(ac, 880, 0.1, 0.16, 0.2, scale);
        break;
      case "win":
        note(ac, 523.25, 0, 0.12, 0.2, scale);
        note(ac, 659.25, 0.1, 0.12, 0.2, scale);
        note(ac, 783.99, 0.2, 0.12, 0.2, scale);
        note(ac, 1046.5, 0.3, 0.25, 0.2, scale);
        break;
      case "lose":
        note(ac, 392, 0, 0.16, 0.18, scale);
        note(ac, 329.63, 0.16, 0.16, 0.18, scale);
        note(ac, 261.63, 0.32, 0.3, 0.18, scale);
        break;
      case "drown":
        noise(ac, 0.3, 0.2, 500, scale);
        break;
      case "invalid":
        tone(ac, {
          type: "square",
          from: 110,
          to: 110,
          dur: 0.1,
          vol: 0.12,
          scale,
        });
        break;
      case "turn":
        // Gentle two-tone: your turn just started.
        note(ac, 440, 0, 0.12, 0.16, scale);
        note(ac, 659.25, 0.12, 0.16, 0.16, scale);
        break;
      case "place":
        // Short setup click.
        tone(ac, { type: "sine", from: 1000, to: 1000, dur: 0.03, vol: 0.12, scale });
        break;
      case "start":
        // Quick rising two-note "go" when play begins.
        note(ac, 523.25, 0, 0.1, 0.18, scale);
        note(ac, 783.99, 0.09, 0.14, 0.18, scale);
        break;
      case "bonus":
        // Extra-steps tail: two quick high sparkles after the box chime.
        note(ac, 880, 0, 0.06, 0.14, scale);
        note(ac, 1318.5, 0.06, 0.08, 0.14, scale);
        break;
      case "bridge":
        // Bridge tail: one warm low thud after the box chime.
        tone(ac, {
          type: "triangle",
          from: 330,
          to: 330,
          dur: 0.2,
          vol: 0.16,
          scale,
        });
        break;
    }
  } catch {
    // Audio must never crash the game.
  }
}
