// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SetupTray from "./SetupTray";

// Phase 3b (TEST_PLAN.md): SetupTray shows draft counts and reports
// character/mode selections. Placement rules live in the engine, not here.

// The suite does not use vitest globals, so Testing Library's
// auto-cleanup never runs — unmount after every test explicitly.
afterEach(() => {
  cleanup();
});

function renderTray(overrides: Partial<Parameters<typeof SetupTray>[0]> = {}) {
  const props = {
    mode: "pieces" as const,
    onModeChange: vi.fn(),
    draftPieceCount: 5,
    trapCount: 3,
    neutralTrapCount: 1,
    draftPieces: {},
    selectedCharacter: "cat" as const,
    onSelectCharacter: vi.fn(),
    ...overrides,
  };
  render(<SetupTray {...props} />);
  return props;
}

describe("SetupTray counts", () => {
  it("shows piece, trap, and neutral trap counts", () => {
    renderTray();
    expect(
      screen.getByRole("button", { name: /Pieces · 5\/15/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Traps · 3\/10 \(neutral 1\/3\)/ }),
    ).toBeTruthy();
  });
});

describe("SetupTray interactions", () => {
  it("reports mode toggles", async () => {
    const user = userEvent.setup();
    const props = renderTray();
    await user.click(screen.getByRole("button", { name: /Traps ·/ }));
    expect(props.onModeChange).toHaveBeenCalledWith("traps");
    await user.click(screen.getByRole("button", { name: /Pieces ·/ }));
    expect(props.onModeChange).toHaveBeenCalledWith("pieces");
  });

  it("reports character selection", async () => {
    const user = userEvent.setup();
    const props = renderTray();
    await user.click(screen.getByRole("button", { name: "🐶 Dog" }));
    expect(props.onSelectCharacter).toHaveBeenCalledWith("dog");
  });

  it("marks placed characters and highlights the selected one", () => {
    renderTray({
      draftPieces: { cat: { x: 0, y: 0 } },
      selectedCharacter: "dog",
    });
    expect(
      screen.getByRole("button", { name: /Cat ✓/ }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "🐶 Dog" })
        .classList.contains("bg-white"),
    ).toBe(true);
  });

  it("hides the character tray in traps mode", () => {
    renderTray({ mode: "traps" });
    expect(screen.queryByRole("button", { name: /Cat/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Dog/ })).toBeNull();
  });
});
