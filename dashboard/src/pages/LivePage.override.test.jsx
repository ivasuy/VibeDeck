/* @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../test/test-utils";
import { LivePage } from "./LivePage.jsx";
import { getAttributionStats, postAttribute } from "../lib/vibedeck-api";

vi.mock("../hooks/use-vibedeck-live-sessions", () => ({
  useVibeDeckLiveSessions: () => ({
    status: "connected",
    error: null,
    sessions: [
      {
        provider: "codex",
        session_id: "s-low",
        repo_root: "/repo/vibedeck",
        branch: "unknown",
        confidence: "low",
        branch_resolution_tier: "C",
        model: "gpt-5.2",
        total_tokens: 200,
        total_cost_usd: 0.02,
      },
    ],
  }),
}));

vi.mock("../lib/vibedeck-api", async () => {
  const actual = await vi.importActual("../lib/vibedeck-api");
  return {
    ...actual,
    getAttributionStats: vi.fn(),
    postAttribute: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAttributionStats).mockResolvedValue({
    high: 0,
    medium: 0,
    low: 1,
    unattributed: 0,
    total: 1,
  });
  vi.mocked(postAttribute).mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
});

describe("LivePage override actions", () => {
  it("shows override controls for selected low confidence sessions and posts branch override", async () => {
    render(<LivePage />);

    const headings = await screen.findAllByRole("heading", { name: "Branch override" });
    expect(headings.length).toBeGreaterThan(0);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "feature/live-fix" } });
    fireEvent.click(screen.getByRole("button", { name: "Save branch override" }));

    await waitFor(() => {
      expect(postAttribute).toHaveBeenCalledWith({
        provider: "codex",
        session_id: "s-low",
        branch: "feature/live-fix",
      });
    });

    await waitFor(() => {
      expect(getAttributionStats).toHaveBeenCalledTimes(2);
    });
  });

  it("clears branch override for selected sessions", async () => {
    render(<LivePage />);

    const headings = await screen.findAllByRole("heading", { name: "Branch override" });
    expect(headings.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Clear override" }));

    await waitFor(() => {
      expect(postAttribute).toHaveBeenCalledWith({
        provider: "codex",
        session_id: "s-low",
        branch: null,
      });
    });
  });
});
