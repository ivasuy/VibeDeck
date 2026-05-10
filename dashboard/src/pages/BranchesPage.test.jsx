/* @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../test/test-utils";
import { BranchesPage } from "./BranchesPage.jsx";

const getBranchUsage = vi.fn();

vi.mock("../lib/vibedeck-api", () => ({
  getBranchUsage: (...args) => getBranchUsage(...args),
}));

const SAMPLE_PAYLOAD = {
  totals: {
    total_tokens: 14500,
    total_cost_usd: 12.34,
    session_count: 5,
  },
  repos: [
    {
      repo_root: "/Users/dev/repo-alpha",
      branches: [
        {
          branch: "feature/live",
          total_tokens: 12000,
          total_cost_usd: 12.34,
          session_count: 3,
          last_seen_at: "2026-05-10T10:10:00.000Z",
          confidence: { high: 2, medium: 1, low: 0, unattributed: 0 },
          models: [
            {
              model: "gpt-5.2",
              total_tokens: 9000,
              total_cost_usd: 9.1,
              session_count: 1,
            },
            {
              model: "claude-opus-4.1",
              total_tokens: 3000,
              total_cost_usd: 3.24,
              session_count: 1,
            },
          ],
          sessions: [
            {
              provider: "codex",
              session_id: "s-001",
              started_at: "2026-05-10T10:00:00.000Z",
              ended_at: "2026-05-10T10:20:00.000Z",
              model: "gpt-5.2",
              total_tokens: 9000,
              total_cost_usd: 9.1,
              confidence: "high",
              branch_resolution_tier: "A",
            },
            {
              provider: "claude",
              session_id: "s-002",
              started_at: "2026-05-10T09:00:00.000Z",
              ended_at: "2026-05-10T09:25:00.000Z",
              model: "claude-opus-4.1",
              total_tokens: 3000,
              total_cost_usd: null,
              confidence: "medium",
              branch_resolution_tier: "B",
            },
          ],
        },
      ],
    },
    {
      repo_root: "/Users/dev/repo-beta",
      branches: [
        {
          branch: "main",
          total_tokens: 2500,
          total_cost_usd: null,
          session_count: 2,
          last_seen_at: "2026-05-09T08:00:00.000Z",
          confidence: { high: 0, medium: 0, low: 1, unattributed: 1 },
          models: [
            {
              model: "gpt-5.1",
              total_tokens: 1200,
              total_cost_usd: null,
              session_count: 1,
            },
          ],
          sessions: [
            {
              provider: "codex",
              session_id: "s-003",
              started_at: "2026-05-09T07:30:00.000Z",
              ended_at: "2026-05-09T08:00:00.000Z",
              model: "gpt-5.1",
              total_tokens: 1200,
              total_cost_usd: null,
              confidence: "low",
              branch_resolution_tier: "C",
            },
          ],
        },
      ],
    },
  ],
};

beforeEach(() => {
  getBranchUsage.mockReset();
  getBranchUsage.mockResolvedValue(SAMPLE_PAYLOAD);
});

afterEach(() => {
  cleanup();
});

describe("BranchesPage", () => {
  it("renders repo rows, totals, confidence mix, and session drill-down", async () => {
    render(<BranchesPage />);

    expect(await screen.findByText("Branch cost intelligence")).toBeTruthy();
    expect(getBranchUsage).toHaveBeenCalledWith({ includeSessions: true, limit: 100 });
    expect(await screen.findByText("/Users/dev/repo-alpha")).toBeTruthy();
    expect(await screen.findByText("/Users/dev/repo-beta")).toBeTruthy();
    expect(screen.getByText("feature/live")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("14,500")).toBeTruthy();
    expect(screen.getByText("high 2 · medium 1 · low 0 · unattributed 0")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Top model" })).toBeTruthy();
    expect(screen.getByText("gpt-5.2 +1")).toBeTruthy();
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: /view sessions/i })[0]);

    expect(await screen.findByText("Session details")).toBeTruthy();
    expect(screen.getByText("s-001")).toBeTruthy();
    expect(screen.getByText("s-002")).toBeTruthy();
    expect(screen.getAllByText("gpt-5.2").length).toBeGreaterThan(0);
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
  });

  it("applies repo and branch filters locally", async () => {
    render(<BranchesPage />);

    await screen.findByText("/Users/dev/repo-alpha");
    fireEvent.change(screen.getByLabelText("Repo filter"), { target: { value: "repo-beta" } });
    fireEvent.change(screen.getByLabelText("Branch filter"), { target: { value: "main" } });

    await waitFor(() => {
      expect(screen.queryByText("/Users/dev/repo-alpha")).toBeNull();
      expect(screen.getByText("/Users/dev/repo-beta")).toBeTruthy();
      expect(screen.getByText("main")).toBeTruthy();
    });
  });
});
