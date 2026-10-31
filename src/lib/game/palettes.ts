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
//
// Each palette also carries one texture per terrain: a small SVG pattern
// painted over the colour (wavy lines on water, speckles on plains).
// Tiles are ~24–33px, so textures stay subtle — 1–2px strokes, low
// opacity — or they turn to noise. The SVGs stay readable here and are
// encoded at module load; the renderer just uses the resulting
// `url("data:image/svg+xml,...")` value as a background image.

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
  /** Texture per terrain type, as CSS background-image values. */
  textures: Record<TerrainType, string>;
  /** What each terrain type is called in this biome, for the legend. */
  terrainLabels: Record<TerrainType, string>;
}

// --- Texture builders (one 24x24 SVG pattern tile each) ---

/** Wrap an SVG fragment in a 24x24 tile and encode it as a CSS image. */
function texture(inner: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'>` +
    inner +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Two sine waves, for water (grass/desert). */
function waves(opacity: string): string {
  return texture(
    `<path d='M0 8 Q6 4 12 8 T24 8' fill='none' stroke='white' ` +
      `stroke-opacity='${opacity}' stroke-width='1.5'/>` +
      `<path d='M0 17 Q6 13 12 17 T24 17' fill='none' stroke='white' ` +
      `stroke-opacity='${opacity}' stroke-width='1.5'/>`,
  );
}

/** Angular hairline cracks, for the frozen lake. */
function cracks(): string {
  return texture(
    `<path d='M3 3 L9 9 L6 17 M15 2 L13 10 L19 15 M21 21 L17 16' ` +
      `fill='none' stroke='white' stroke-opacity='0.4' stroke-width='1'/>`,
  );
}

/** Scattered dots, for plains (and denser, for grass forest). */
function dots(
  fill: string,
  opacity: string,
  points: Array<[number, number, number]>,
): string {
  return texture(
    points
      .map(
        ([x, y, r]) =>
          `<circle cx='${x}' cy='${y}' r='${r}' fill='${fill}' ` +
          `fill-opacity='${opacity}'/>`,
      )
      .join(""),
  );
}

/** Short angled strokes, for dry scrub. */
function tufts(stroke: string, opacity: string): string {
  const strokes: Array<[number, number, number, number]> = [
    [4, 7, 1, -4],
    [9, 5, -1, -3],
    [15, 8, 1, -4],
    [19, 6, 0, -3],
    [7, 18, 1, -4],
    [16, 19, -1, -3],
  ];
  return texture(
    strokes
      .map(
        ([x, y, dx, dy]) =>
          `<path d='M${x} ${y} l${dx} ${dy}' fill='none' stroke='${stroke}' ` +
          `stroke-opacity='${opacity}' stroke-width='1.4' stroke-linecap='round'/>`,
      )
      .join(""),
  );
}

/** A tiny dark pine with snow dots, for snowy pine. */
function pine(): string {
  return texture(
    `<path d='M12 3 L17 13 L7 13 Z' fill='#1d4a46' fill-opacity='0.55'/>` +
      `<circle cx='5' cy='19' r='1.2' fill='white' fill-opacity='0.6'/>` +
      `<circle cx='19' cy='17' r='1' fill='white' fill-opacity='0.6'/>`,
  );
}

const SCATTER: Array<[number, number, number]> = [
  [4, 5, 1.3],
  [14, 3, 1],
  [18, 14, 1.3],
  [8, 18, 1],
  [20, 21, 1],
];

export const BIOME_PALETTES: Record<BiomeId, BiomePalette> = {
  grass: {
    label: "Grass / Forest",
    colors: {
      plains: "#86c95e",
      forest: "#2e7d32",
      water: "#2b6fd6",
    },
    textures: {
      plains: dots("#1b5e20", "0.18", SCATTER),
      forest: dots("#14501c", "0.30", [...SCATTER, [12, 11, 1.4]]),
      water: waves("0.28"),
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
    textures: {
      plains: dots("#8a6d1b", "0.22", SCATTER),
      forest: tufts("#6b5a1e", "0.5"),
      water: waves("0.32"),
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
    textures: {
      plains: dots("#aebfc7", "0.7", SCATTER),
      forest: pine(),
      water: cracks(),
    },
    terrainLabels: {
      plains: "Snow",
      forest: "Snowy pine",
      water: "Frozen lake",
    },
  },
};
