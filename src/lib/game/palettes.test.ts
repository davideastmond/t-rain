import { describe, expect, it } from "vitest";

import { BIOME_PALETTES } from "./palettes";

// Tile textures ride with the palette: every biome must define one
// SVG data URI per terrain, or that terrain renders flat. TypeScript
// already enforces the keys; these tests guard against empty or
// copy-pasted values.
describe("BIOME_PALETTES textures", () => {
  it("defines a data-URI texture for every biome and terrain", () => {
    for (const [biome, palette] of Object.entries(BIOME_PALETTES)) {
      for (const terrain of ["plains", "forest", "water"] as const) {
        expect(palette.textures[terrain], `${biome}/${terrain}`).toMatch(
          /^url\("data:image\/svg\+xml,/,
        );
      }
    }
  });

  it("textures differ by terrain within a biome", () => {
    for (const palette of Object.values(BIOME_PALETTES)) {
      expect(new Set(Object.values(palette.textures)).size).toBe(3);
    }
  });
});
