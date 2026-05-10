/* @vitest-environment jsdom */

import React from "react";
import { fireEvent, screen } from "@testing-library/react";
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
      {
        provider: "codex",
        session_id: "s2",
        repo_root: "/repo/vibedeck",
        branch: "feature/costs",
        confidence: "medium",
        branch_resolution_tier: "B",
        model: "gpt-5.4",
        total_tokens: 5000,
        total_cost_usd: null,
        estimated_total_cost_usd: 0.05,
        cost_estimated: true,
      },
      {
        provider: "unknown",
        session_id: "s3",
        repo_root: "/repo/unknown",
        branch: "mystery",
        confidence: "low",
        branch_resolution_tier: "C",
        model: "totally-unknown-model",
        total_tokens: 5000,
        total_cost_usd: 0,
        estimated_total_cost_usd: null,
        cost_estimated: true,
        cost_quality: "pricing_missing",
      },
      {
        provider: "gemini",
        session_id: "s4",
        repo_root: "/repo/zero",
        branch: "idle",
        confidence: "medium",
        branch_resolution_tier: "D",
        model: "gemini-2.5-flash-lite",
        total_tokens: 0,
        total_cost_usd: 0,
        estimated_total_cost_usd: 0,
        cost_estimated: false,
        cost_quality: "zero_tokens",
      },
    ],
  }),
}));

vi.mock("../lib/vibedeck-api", () => ({
  getAttributionStats: () =>
    Promise.resolve({ high: 1, medium: 0, low: 0, unattributed: 0, total: 1 }),
  getSyncStatus: () =>
    Promise.resolve({
      last_parse_at: "2026-05-10T09:30:00.000Z",
      queue_updated_at: "2026-05-10T09:30:00.000Z",
      project_queue_updated_at: "2026-05-10T09:30:00.000Z",
      session_count: 1,
      open_session_count: 1,
      sync_enabled: false,
    }),
}));

describe("LivePage", () => {
  it("renders grouped projects and preserves selected session behavior", async () => {
    render(<LivePage />);

    expect(await screen.findByText("Live Workbench")).toBeTruthy();
    expect(screen.getByText("Selected session")).toBeTruthy();
    expect(screen.getAllByText(/vibedeck/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Selected repo: /repo/vibedeck")).toBeTruthy();
    expect(screen.getAllByText("main").length).toBeGreaterThan(0);
    expect(screen.getAllByText("feature/costs").length).toBeGreaterThan(0);
    expect(screen.getAllByText("mystery").length).toBeGreaterThan(0);
    expect(screen.getAllByText("idle").length).toBeGreaterThan(0);
    expect(screen.getAllByText("high").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$0.05 est.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$0.00").length).toBeGreaterThan(0);
    expect(screen.getByText("Local sync is disabled. Live data may be stale.")).toBeTruthy();
    expect(screen.getAllByText("Branch totals").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Providers").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Projects").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Select session unknown mystery s3" }));
    expect(screen.getAllByText("Current branch").length).toBeGreaterThan(0);
    expect(screen.getByText("Branch: mystery")).toBeTruthy();
    expect(screen.getByText("Selected repo: /repo/unknown")).toBeTruthy();
  });
});
