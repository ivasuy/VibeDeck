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
        total_cost_usd: null,
        estimated_total_cost_usd: null,
        cost_estimated: true,
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
  it("renders active sessions and attribution confidence", async () => {
    render(<LivePage />);

    expect(await screen.findByText("Live Workbench")).toBeTruthy();
    expect(screen.getAllByText(/codex/i).length).toBeGreaterThan(0);
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("feature/costs")).toBeTruthy();
    expect(screen.getByText("mystery")).toBeTruthy();
    expect(screen.getAllByText("high").length).toBeGreaterThan(0);
    expect(screen.getByText("$0.05 est.")).toBeTruthy();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("$0.00")).toBeNull();
    expect(screen.getByText("Local sync is disabled. Live data may be stale.")).toBeTruthy();
  });
});
