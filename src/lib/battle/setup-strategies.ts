// Setup strategy registry (HARD_CPU_PHASE2_SPEC.md §1.3), separate from
// the play registry: a tournament pairs a play strategy with a setup
// strategy per side, so a setup idea is measured with play held fixed
// (and vice versa). Versions bump on behavior change, same convention
// as play strategies.

import { autoPlaceSetup, type ApplySetupResult } from "../game/setup";
import { chooseChokeSetup } from "../game/setup-choke";
import type { GameState, PlayerId } from "../game/types";

export interface SetupStrategy {
  id: string;
  version: string;
  label: string;
  choose: (state: GameState, player: PlayerId) => ApplySetupResult;
}

export const SETUP_STRATEGIES: SetupStrategy[] = [
  {
    id: "auto",
    version: "auto@v1",
    label: "Auto (random traps)",
    choose: autoPlaceSetup,
  },
  {
    id: "choke",
    version: "choke@v1",
    label: "Choke-point traps",
    choose: chooseChokeSetup,
  },
];

export function getSetupStrategy(id: string): SetupStrategy {
  const strategy = SETUP_STRATEGIES.find((s) => s.id === id);
  if (!strategy) throw new Error(`Unknown setup strategy: ${id}`);
  return strategy;
}
