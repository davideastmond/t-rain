// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createGame } from "@/lib/game/setup";
import type { Piece } from "@/lib/game/types";

import Board from "./Board";

// Phase 3a (TEST_PLAN.md): Board renders engine state and reports
// clicks. It does not re-implement rules — no movement/nerf/box logic
// is asserted through the UI here.

const tiles = createGame(42).tiles;

// The suite does not use vitest globals, so Testing Library's
// auto-cleanup never runs — unmount after every test explicitly.
afterEach(() => {
  cleanup();
});

function piece(
  id: string,
  owner: "north" | "south",
  x: number,
  y: number,
  patch: Partial<Piece> = {},
): Piece {
  return {
    id,
    character: "cat",
    owner,
    position: { x, y },
    status: "active",
    hasBridge: false,
    hasTrapSense: false,
    ...patch,
  };
}

describe("Board rendering", () => {
  it("renders one tile per board position", () => {
    render(<Board tiles={tiles} biome="grass" piecesKey="test" />);
    const grid = screen.getByRole("img", { name: /T-rain board/ });
    expect(grid.children.length).toBe(930);
  });

  it("draws active pieces by character and hides eliminated ones", () => {
    render(
      <Board
        tiles={tiles}
        biome="grass"
        piecesKey="test"
        pieces={[
          piece("north-cat", "north", 5, 5),
          piece("south-dog", "south", 10, 10, { character: "dog" }),
          piece("north-horse", "north", 3, 3, {
            character: "horse",
            status: "eliminated",
          }),
        ]}
      />,
    );
    expect(screen.getByTitle("North Cat").textContent).toContain("🐱");
    expect(screen.getByTitle("South Dog").textContent).toContain("🐶");
    expect(screen.queryByTitle("North Horse")).toBeNull();
  });

  it("labels own, revealed, and triggered traps differently", () => {
    render(
      <Board
        tiles={tiles}
        biome="grass"
        piecesKey="test"
        traps={[
          { owner: "north", position: { x: 2, y: 2 }, triggered: false },
          { owner: "south", position: { x: 7, y: 7 }, triggered: false },
          { owner: "south", position: { x: 8, y: 8 }, triggered: true },
        ]}
        revealedTrapKeys={new Set(["7,7"])}
      />,
    );
    expect(screen.getByTitle("Trap").textContent).toContain("💣");
    expect(
      screen.getByTitle("Revealed trap — still live!").textContent,
    ).toContain("💣");
    expect(screen.getByTitle("Triggered trap").textContent).toContain("💥");
  });

  it("labels post-game revealed traps differently from live ones", () => {
    render(
      <Board
        tiles={tiles}
        biome="grass"
        piecesKey="test"
        traps={[
          { owner: "north", position: { x: 2, y: 2 }, triggered: false },
          { owner: "south", position: { x: 7, y: 7 }, triggered: false },
        ]}
        revealedTrapKeys={new Set(["7,7"])}
        postGame
      />,
    );
    expect(screen.getByTitle("Trap").textContent).toContain("💣");
    expect(
      screen.getByTitle("Hidden trap — revealed after the game").textContent,
    ).toContain("💣");
  });

  it("draws a nerf marker on the nerfed tile", () => {
    render(
      <Board
        tiles={tiles}
        biome="grass"
        piecesKey="test"
        nerfMarkers={[{ position: { x: 5, y: 5 }, victim: "south" }]}
      />,
    );
    expect(
      screen.getByTitle("Piece nerfed here — clears when South's turn ends")
        .textContent,
    ).toContain("⚡");
  });

  it("draws uncollected boxes and hides collected ones", () => {
    render(
      <Board
        tiles={tiles}
        biome="grass"
        piecesKey="test"
        mysteryBoxes={[
          { position: { x: 4, y: 4 }, collected: false },
          { position: { x: 6, y: 6 }, collected: true },
        ]}
      />,
    );
    expect(
      screen.getAllByTitle("Mystery box — only the invader can collect it"),
    ).toHaveLength(1);
  });

  it("rings the selected piece and leaves the others with a thin ring", () => {
    render(
      <Board
        tiles={tiles}
        biome="grass"
        piecesKey="test"
        pieces={[
          piece("north-cat", "north", 5, 5),
          piece("south-dog", "south", 10, 10, { character: "dog" }),
        ]}
        selectedKey="5,5"
      />,
    );
    expect(screen.getByTitle("North Cat").classList.contains("ring-4")).toBe(
      true,
    );
    expect(screen.getByTitle("South Dog").classList.contains("ring-4")).toBe(
      false,
    );
  });

  it("outlines highlighted tiles white and danger tiles red", () => {
    render(
      <Board
        tiles={tiles}
        biome="grass"
        piecesKey="test"
        highlighted={new Set(["10,10"])}
        dangerHighlighted={new Set(["5,5"])}
      />,
    );
    const highlighted = screen.getByTitle(/\(10, 10\)$/);
    expect((highlighted as HTMLElement).style.boxShadow).toContain(
      "255, 255, 255",
    );
    const danger = screen.getByTitle(/\(5, 5\)$/);
    expect((danger as HTMLElement).style.boxShadow).toContain("239, 68, 68");
  });

  it("shades the neutral row when nothing else outlines it", () => {
    render(<Board tiles={tiles} biome="grass" piecesKey="test" />);
    const neutral = screen.getByTitle(/\(0, 15\)$/);
    expect((neutral as HTMLElement).style.boxShadow).toContain("0, 0, 0");
  });

  it("shows bridge and trap-sense badges on pieces that hold them", () => {
    render(
      <Board
        tiles={tiles}
        biome="grass"
        piecesKey="test"
        pieces={[
          piece("north-cat", "north", 5, 5, { hasBridge: true }),
          piece("south-dog", "south", 10, 10, {
            character: "dog",
            hasTrapSense: true,
          }),
        ]}
      />,
    );
    expect(
      screen.getByTitle("Holds a bridge — can cross one water tile").textContent,
    ).toContain("🌉");
    expect(
      screen.getByTitle(
        "Has trap sense this turn — the traps next to it are revealed to its owner",
      ).textContent,
    ).toContain("🔍");
  });
});

describe("Board clicks", () => {
  it("reports the clicked tile's position", async () => {
    const user = userEvent.setup();
    const onTileClick = vi.fn();
    render(
      <Board tiles={tiles} biome="grass" piecesKey="test" onTileClick={onTileClick} />,
    );
    await user.click(screen.getByTitle(/\(5, 5\)$/));
    expect(onTileClick).toHaveBeenCalledTimes(1);
    expect(onTileClick).toHaveBeenCalledWith({ x: 5, y: 5 });
  });

  it("does not crash when no click handler is given", async () => {
    const user = userEvent.setup();
    render(<Board tiles={tiles} biome="grass" piecesKey="test" />);
    await user.click(screen.getByTitle(/\(5, 5\)$/));
  });
});
