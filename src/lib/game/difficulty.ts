// CPU difficulty tiers for the local page (HARD_CPU_PHASE2_SPEC.md
// step 5). Normal is exactly today's CPU (full play + auto setup);
// Hard pairs hard@v4 play with choke setup. Both tiers are expressed
// as registry ids so the page never branches on strategy internals,
// and the final combined tournament measures these same two tiers.
import { getSetupStrategy } from "../battle/setup-strategies";
import { getStrategy } from "../battle/strategies";
import type { CpuAction } from "./cpu";
import type { GameState, PlayerId } from "./types";

export type CpuDifficulty = "normal" | "hard";

export const CPU_DIFFICULTIES: Record<
  CpuDifficulty,
  { play: string; setup: string; label: string }
> = {
  normal: { play: "full", setup: "auto", label: "Normal" },
  hard: { play: "hard", setup: "choke", label: "Hard" },
};

/** One CPU action under a difficulty tier, from the sanitized view. */
export function chooseDifficultyAction(
  difficulty: CpuDifficulty,
  view: GameState,
  player: PlayerId,
  rng: () => number = Math.random,
): CpuAction | null {
  return getStrategy(CPU_DIFFICULTIES[difficulty].play).choose(
    view,
    player,
    rng,
  );
}

/** CPU setup under a difficulty tier (pieces + traps). */
export function chooseDifficultySetup(
  difficulty: CpuDifficulty,
  state: GameState,
  player: PlayerId,
) {
  return getSetupStrategy(CPU_DIFFICULTIES[difficulty].setup).choose(
    state,
    player,
  );
}
