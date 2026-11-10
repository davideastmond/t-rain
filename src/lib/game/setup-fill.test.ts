import { describe, expect, it } from "vitest";

import { ALL_CHARACTERS, applySetup, autoPlaceSetup, createGame, fillSetupDraft, isInPieceZone, isInTrapZone } from "./setup";
import { suggestChokeTraps } from "./setup-choke";
import { MAX_NEUTRAL_TRAPS, NEUTRAL_ROW, PIECES_PER_PLAYER, TRAPS_PER_PLAYER } from "./constants";
import type { CharacterId, GameState, Position } from "./types";

// Setup draft filling ("auto-place the rest") and choke trap suggestions:
// the manual part of a draft survives, only the missing pieces and traps
// are placed, and the result is a legal setup the lock-in step accepts.

function passable(state: GameState, position: Position): boolean {
  return (
    state.tiles.find(
      (t) => t.position.x === position.x && t.position.y === position.y,
    )?.terrain !== "water"
  );
}

function key(p: Position): string {
  return `${p.x},${p.y}`;
}

// A partial draft built from the game's own tiles: the first passable
// piece-zone tiles for pieces, the first legal trap-zone tiles for traps
// (never on a box, never on a piece tile, at most 3 on the neutral row).
function partialDraft(
  state: GameState,
  player: "north" | "south",
  pieceCount: number,
  trapCount: number,
): {
  pieces: Partial<Record<CharacterId, Position>>;
  traps: Position[];
} {
  const piecePositions = state.tiles
    .filter((t) => isInPieceZone(player, t.position) && passable(state, t.position))
    .slice(0, pieceCount)
    .map((t) => t.position);
  const pieces: Partial<Record<CharacterId, Position>> = {};
  ALL_CHARACTERS.slice(0, pieceCount).forEach((character, i) => {
    pieces[character] = piecePositions[i];
  });
  const boxKeys = new Set(state.mysteryBoxes.map((b) => key(b.position)));
  const pieceKeys = new Set(piecePositions.map(key));
  const traps: Position[] = [];
  let neutral = 0;
  for (const tile of state.tiles) {
    if (traps.length >= trapCount) break;
    const { position } = tile;
    if (!isInTrapZone(player, position)) continue;
    if (!passable(state, position)) continue;
    if (boxKeys.has(key(position))) continue;
    if (pieceKeys.has(key(position))) continue;
    if (position.y === NEUTRAL_ROW) {
      if (neutral >= MAX_NEUTRAL_TRAPS) continue;
      neutral++;
    }
    traps.push(position);
  }
  return { pieces, traps };
}

function placementsFromDraft(pieces: Partial<Record<CharacterId, Position>>) {
  return ALL_CHARACTERS.map((character) => ({
    character,
    position: pieces[character]!,
  }));
}

describe("fillSetupDraft", () => {
  it("fills an empty draft to a complete legal setup", () => {
    const state = createGame(7);
    const filled = fillSetupDraft(state, "south", {}, []);
    expect(Object.keys(filled.pieces)).toHaveLength(PIECES_PER_PLAYER);
    expect(filled.traps).toHaveLength(TRAPS_PER_PLAYER);
    const result = applySetup(
      state,
      "south",
      placementsFromDraft(filled.pieces),
      filled.traps,
    );
    expect(result.ok).toBe(true);
  });

  it("fills an empty draft to exactly the auto-place placement", () => {
    for (const seed of [7, 42]) {
      const state = createGame(seed);
      const filled = fillSetupDraft(state, "south", {}, []);
      const auto = autoPlaceSetup(state, "south");
      expect(auto.ok).toBe(true);
      if (!auto.ok) continue;
      const autoPieces = new Set(
        auto.state.pieces
          .filter((p) => p.owner === "south")
          .map((p) => `${p.character}@${key(p.position)}`),
      );
      const filledPieces = new Set(
        Object.entries(filled.pieces).map(([c, p]) => `${c}@${key(p!)}`),
      );
      expect(filledPieces).toEqual(autoPieces);
      expect(new Set(filled.traps.map(key))).toEqual(
        new Set(
          auto.state.traps
            .filter((t) => t.owner === "south")
            .map((t) => key(t.position)),
        ),
      );
    }
  });

  it("keeps manual placements and fills only the rest", () => {
    const state = createGame(7);
    const draft = partialDraft(state, "south", 3, 2);
    const filled = fillSetupDraft(state, "south", draft.pieces, draft.traps);
    for (const [character, position] of Object.entries(draft.pieces)) {
      expect(filled.pieces[character as CharacterId]).toEqual(position);
    }
    expect(filled.traps.slice(0, 2)).toEqual(draft.traps);
    expect(Object.keys(filled.pieces)).toHaveLength(PIECES_PER_PLAYER);
    expect(filled.traps).toHaveLength(TRAPS_PER_PLAYER);
    const result = applySetup(
      state,
      "south",
      placementsFromDraft(filled.pieces),
      filled.traps,
    );
    expect(result.ok).toBe(true);
  });

  it("returns a complete draft unchanged", () => {
    const state = createGame(7);
    const draft = partialDraft(state, "south", PIECES_PER_PLAYER, TRAPS_PER_PLAYER);
    const filled = fillSetupDraft(state, "south", draft.pieces, draft.traps);
    expect(filled.pieces).toEqual(draft.pieces);
    expect(filled.traps).toEqual(draft.traps);
  });

  it("is deterministic for the same seed and draft", () => {
    const state = createGame(7);
    const draft = partialDraft(state, "south", 5, 4);
    const first = fillSetupDraft(state, "south", draft.pieces, draft.traps);
    const second = fillSetupDraft(state, "south", draft.pieces, draft.traps);
    expect(second).toEqual(first);
  });

  it("respects the neutral cap against manual traps", () => {
    const state = createGame(7);
    // Manual traps already using all 3 neutral slots.
    const neutralTraps = state.tiles
      .filter(
        (t) =>
          t.position.y === NEUTRAL_ROW &&
          passable(state, t.position) &&
          isInTrapZone("south", t.position),
      )
      .slice(0, MAX_NEUTRAL_TRAPS)
      .map((t) => t.position);
    expect(neutralTraps).toHaveLength(MAX_NEUTRAL_TRAPS);
    const filled = fillSetupDraft(state, "south", {}, neutralTraps);
    expect(
      filled.traps.filter((p) => p.y === NEUTRAL_ROW),
    ).toHaveLength(MAX_NEUTRAL_TRAPS);
  });

  it("never stacks a filled piece on a draft trap or a trap on a piece", () => {
    const state = createGame(7);
    const draft = partialDraft(state, "south", 4, 6);
    const filled = fillSetupDraft(state, "south", draft.pieces, draft.traps);
    const draftTrapKeys = new Set(draft.traps.map(key));
    for (const [character, position] of Object.entries(filled.pieces)) {
      if (draft.pieces[character as CharacterId]) continue;
      expect(draftTrapKeys.has(key(position!))).toBe(false);
    }
    const pieceKeys = new Set(
      Object.values(filled.pieces).map((p) => key(p!)),
    );
    for (const trap of filled.traps) {
      expect(pieceKeys.has(key(trap))).toBe(false);
    }
  });
});

describe("suggestChokeTraps", () => {
  it("suggests 10 legal traps avoiding the given pieces, deterministically", () => {
    const state = createGame(7);
    const draft = partialDraft(state, "south", 5, 0);
    const piecePositions = Object.values(draft.pieces).map((p) => p!);
    const first = suggestChokeTraps(state, "south", piecePositions);
    const second = suggestChokeTraps(state, "south", piecePositions);
    expect(first).toEqual(second);
    expect(first).toHaveLength(TRAPS_PER_PLAYER);
    for (const trap of first) {
      expect(piecePositions.some((p) => key(p) === key(trap))).toBe(false);
    }
    const result = applySetup(
      state,
      "south",
      placementsFromDraft(fillSetupDraft(state, "south", draft.pieces, []).pieces),
      first,
    );
    expect(result.ok).toBe(true);
  });
});
