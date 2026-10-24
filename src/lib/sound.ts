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
  | "invalid";

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

/** Base sound for a step, plus the trap-sense shimmer whenever the step
    revealed traps. Callers must only use this for the *viewing*
    player's own steps — the CPU's reveals are private (PR #43), so CPU
    steps play `soundForStepOutcome` alone, never the shimmer. */
export function playStepSounds(outcome: StepOutcome): void {
  playSound(soundForStepOutcome(outcome));
  if (outcome.revealed.length > 0) playSound("trapSense");
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
  gain.gain.setValueAtTime(opts.vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + opts.dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + opts.dur + 0.02);
}

function noise(ac: AudioContext, dur: number, vol: number, cutoff: number): void {
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
  gain.gain.setValueAtTime(vol, ac.currentTime);
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
): void {
  tone(ac, { type: "sine", from: freq, to: freq, at, dur, vol });
}

export function playSound(name: SoundName): void {
  if (isMuted()) return;
  const ac = getContext();
  if (!ac) return;
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
        });
        break;
      case "trap":
        noise(ac, 0.2, 0.25, 1200);
        tone(ac, { type: "square", from: 220, to: 60, dur: 0.2, vol: 0.18 });
        break;
      case "nerf":
        tone(ac, { type: "sawtooth", from: 900, to: 150, dur: 0.15, vol: 0.2 });
        break;
      case "box":
        note(ac, 523.25, 0, 0.09, 0.18);
        note(ac, 659.25, 0.06, 0.09, 0.18);
        note(ac, 783.99, 0.12, 0.12, 0.18);
        break;
      case "trapSense":
        tone(ac, { type: "sine", from: 1200, to: 1800, dur: 0.15, vol: 0.1 });
        break;
      case "score":
        note(ac, 659.25, 0, 0.12, 0.2);
        note(ac, 880, 0.1, 0.16, 0.2);
        break;
      case "win":
        note(ac, 523.25, 0, 0.12, 0.2);
        note(ac, 659.25, 0.1, 0.12, 0.2);
        note(ac, 783.99, 0.2, 0.12, 0.2);
        note(ac, 1046.5, 0.3, 0.25, 0.2);
        break;
      case "lose":
        note(ac, 392, 0, 0.16, 0.18);
        note(ac, 329.63, 0.16, 0.16, 0.18);
        note(ac, 261.63, 0.32, 0.3, 0.18);
        break;
      case "drown":
        noise(ac, 0.3, 0.2, 500);
        break;
      case "invalid":
        tone(ac, { type: "square", from: 110, to: 110, dur: 0.1, vol: 0.12 });
        break;
    }
  } catch {
    // Audio must never crash the game.
  }
}
