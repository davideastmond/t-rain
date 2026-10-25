import { tileIndex } from "./board";
import { ALL_CHARACTERS, createGame } from "./setup";
import type {
  GameState,
  Piece,
  PlayerId,
  Position,
  TerrainType,
} from "./types";

/**
 * Test-only state builders. Imported by `*.test.ts` files only — never
 * by game code.
 *
 * `scenarioGame` starts from a real `createGame(seed)` so tiles, boxes,
 * and the state shape are genuine, then parks full 15-piece rosters out
 * of the way (north on y = 2, south on y = 27) with no traps, in
 * "playing" phase. Full rosters matter: win/attrition math counts
 * active + scored, so a trimmed roster would change the rules under
 * test. Tests relocate the piece under test and add exactly the
 * traps/terrain their scenario needs.
 */
export function scenarioGame(
  seed = 42,
  currentPlayer: PlayerId = "north",
): GameState {
  const base = createGame(seed);
  const roster = (owner: PlayerId, y: number): Piece[] =>
    ALL_CHARACTERS.map((character, i) => ({
      id: `${owner}-${character}`,
      character,
      owner,
      position: { x: i, y },
      status: "active" as const,
      hasBridge: false,
      hasTrapSense: false,
    }));
  return {
    ...base,
    // Parked rows are pinned to plains: a roster piece must never start
    // a test standing on generated water, or endTurn would drown it.
    tiles: base.tiles.map((tile) =>
      tile.position.y === 2 || tile.position.y === 27
        ? { ...tile, terrain: "plains" as const }
        : tile,
    ),
    pieces: [...roster("north", 2), ...roster("south", 27)],
    traps: [],
    phase: "playing",
    currentPlayer,
  };
}

/** Return a copy of `state` with one piece moved and optionally patched. */
export function movePieceTo(
  state: GameState,
  pieceId: string,
  position: Position,
  patch: Partial<Piece> = {},
): GameState {
  return {
    ...state,
    pieces: state.pieces.map((piece) =>
      piece.id === pieceId ? { ...piece, position, ...patch } : piece,
    ),
  };
}

/** Return a copy of `state` with one tile's terrain replaced. */
export function setTerrain(
  state: GameState,
  x: number,
  y: number,
  terrain: TerrainType,
): GameState {
  const tiles = [...state.tiles];
  tiles[tileIndex(x, y)] = { ...tiles[tileIndex(x, y)], terrain };
  return { ...state, tiles };
}

/** Return a copy of `state` with one (untriggered, unless said) trap added. */
export function addTrap(
  state: GameState,
  owner: PlayerId,
  position: Position,
  triggered = false,
): GameState {
  return { ...state, traps: [...state.traps, { owner, position, triggered }] };
}
