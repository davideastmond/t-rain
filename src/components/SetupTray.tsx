// The shared setup-screen controls: the pieces/traps mode toggle and the
// character tray. Both the local game and the network client run the same
// draft-placement flow, so these controls live here instead of being
// declared once per page.

import {
  CHARACTERS,
  MAX_NEUTRAL_TRAPS,
  PIECES_PER_PLAYER,
  TRAPS_PER_PLAYER,
} from "@/lib/game/constants";
import { ALL_CHARACTERS } from "@/lib/game/setup";
import type { CharacterId, Position } from "@/lib/game/types";

export type SetupMode = "pieces" | "traps";

interface SetupTrayProps {
  mode: SetupMode;
  onModeChange: (mode: SetupMode) => void;
  draftPieceCount: number;
  trapCount: number;
  neutralTrapCount: number;
  draftPieces: Partial<Record<CharacterId, Position>>;
  selectedCharacter: CharacterId;
  onSelectCharacter: (character: CharacterId) => void;
}

export default function SetupTray({
  mode,
  onModeChange,
  draftPieceCount,
  trapCount,
  neutralTrapCount,
  draftPieces,
  selectedCharacter,
  onSelectCharacter,
}: SetupTrayProps) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => onModeChange("pieces")}
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
          onClick={() => onModeChange("traps")}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
            mode === "traps"
              ? "bg-emerald-600 text-white"
              : "bg-neutral-800 hover:bg-neutral-700"
          }`}
        >
          💣 Traps · {trapCount}/{TRAPS_PER_PLAYER} (neutral{" "}
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
                onClick={() => onSelectCharacter(character)}
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
  );
}
