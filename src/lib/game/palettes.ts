// How terrain is drawn: one colour palette per biome.
//
// This file is the whole "graphics system" of the colored-squares style:
// the renderer asks "what colour is a forest tile in the ice biome?" and
// looks it up here. Because the tables are keyed by the BiomeId and
// TerrainType unions, TypeScript refuses to compile if a biome is missing a
// colour for a terrain type — add a terrain type and every palette must
// provide one.
//
// The flavour names are what each terrain *reads as* in that biome (desert
// forest is dry scrub, ice water is a frozen lake). The underlying terrain
// type, and its movement cost, never changes — only the paint does.

import type { BiomeId, PlayerId, TerrainType } from "./types";

/**
 * Team colours for piece markers. Ownership has to be readable at a glance
 * in any biome, so these are strong, terrain-unlike colours and the same in
 * every biome: North is always blue, South is always red.
 */
export const PLAYER_COLORS: Record<PlayerId, string> = {
  north: "#2563eb",
  south: "#dc2626",
};

export interface BiomePalette {
  /** Display name of the biome, e.g. "Desert / Dry". */
  label: string;
  /** Colour per terrain type, as CSS colours. */
  colors: Record<TerrainType, string>;
  /** What each terrain type is called in this biome, for the legend. */
  terrainLabels: Record<TerrainType, string>;
}

export const BIOME_PALETTES: Record<BiomeId, BiomePalette> = {
  grass: {
    label: "Grass / Forest",
    colors: {
      plains: "#86c95e",
      forest: "#2e7d32",
      water: "#2b6fd6",
    },
    terrainLabels: {
      plains: "Grass",
      forest: "Forest",
      water: "Water",
    },
  },
  desert: {
    label: "Desert / Dry",
    colors: {
      plains: "#e6d18c",
      forest: "#9c8a3c",
      water: "#2f9ec4",
    },
    terrainLabels: {
      plains: "Sand",
      forest: "Dry scrub",
      water: "Oasis",
    },
  },
  ice: {
    label: "Ice",
    colors: {
      plains: "#eef4f6",
      forest: "#2f6f6a",
      water: "#2b5ea8",
    },
    terrainLabels: {
      plains: "Snow",
      forest: "Snowy pine",
      water: "Frozen lake",
    },
  },
};
