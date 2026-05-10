/* @vitest-environment jsdom */

import React from "react";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { render } from "../test/test-utils";
import { LivePage } from "./LivePage.jsx";

vi.mock("../hooks/use-vibedeck-live-sessions", () => ({
  useVibeDeckLiveSessions: () => ({
    status: "connected",
    error: null,
    sessions: [
      {
        provider: "codex",
        session_id: "s1",
        repo_root: "/repo/vibedeck",
        branch: "main",
        confidence: "high",
        branch_resolution_tier: "A",
        model: "gpt-5.2",
        total_tokens: 1200,
        total_cost_usd: 0.12,
      },
    ],
  }),
}));

vi.mock("../lib/vibedeck-api", () => ({
  getAttributionStats: () =>
    Promise.resolve({ high: 1, medium: 0, low: 0, unattributed: 0, total: 1 }),
}));

describe("LivePage", () => {
  it("renders active sessions and attribution confidence", async () => {
    render(<LivePage />);

    expect(await screen.findByText("Live Workbench")).toBeTruthy();
    expect(screen.getByText(/codex/i)).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getAllByText("high").length).toBeGreaterThan(0);
  });
});
