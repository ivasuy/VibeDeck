/* @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "../lib/copy";
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
    cost_estimated: true,
    cost_quality: "mixed_known",
    session_count: 5,
  },
  repos: [
    {
      repo_root: "/repo-a",
      branches: [
        {
          branch: "feature-a",
          total_tokens: 12000,
          total_cost_usd: 12.34,
          cost_estimated: true,
          cost_quality: "estimated_total_tokens",
          session_count: 3,
          last_seen_at: "2026-05-10T10:10:00.000Z",
          confidence: { high: 2, medium: 1, low: 0, unattributed: 0 },
          models: [
            {
              model: "gpt-5.2",
              total_tokens: 9000,
              total_cost_usd: 9.1,
              cost_estimated: true,
              cost_quality: "estimated_total_tokens",
              session_count: 1,
            },
            {
              model: "claude-opus-4.1",
              total_tokens: 3000,
              total_cost_usd: 3.24,
              cost_estimated: false,
              cost_quality: "stored",
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
              cost_estimated: true,
              cost_quality: "estimated_total_tokens",
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
      repo_root: "/repo-b",
      branches: [
        {
          branch: "release-b",
          total_tokens: 2500,
          total_cost_usd: null,
          cost_estimated: true,
          cost_quality: "partial_unknown",
          session_count: 2,
          last_seen_at: "2026-05-09T08:00:00.000Z",
          confidence: { high: 0, medium: 0, low: 1, unattributed: 1 },
          models: [
            {
              model: "gpt-5.1",
              total_tokens: 1200,
              total_cost_usd: null,
              cost_estimated: true,
              cost_quality: "pricing_missing",
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

function makePayload(repos) {
  return {
    totals: {
      total_tokens: 0,
      total_cost_usd: 0,
      session_count: 0,
    },
    repos,
  };
}

beforeEach(() => {
  getBranchUsage.mockReset();
  getBranchUsage.mockResolvedValue(SAMPLE_PAYLOAD);
});

afterEach(() => {
  cleanup();
});

describe("BranchesPage", () => {
  it("renders the selected project rows, totals, confidence mix, and session drill-down", async () => {
    render(<BranchesPage />);

    expect(await screen.findByText("Branch cost intelligence")).toBeTruthy();
    expect(getBranchUsage).toHaveBeenCalledWith({ includeSessions: true, limit: 100 });
    expect(screen.getByRole("combobox", { name: copy("branches.project.select_label") })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: copy("branches.table.repo") })).toBeNull();
    expect(screen.queryByText("/repo-a")).toBeNull();
    expect(screen.getByText("feature-a")).toBeTruthy();
    expect(screen.queryByText("/repo-b")).toBeNull();
    expect(screen.queryByText("release-b")).toBeNull();
    expect(screen.queryByText("Showing 1 of 1 branches")).toBeNull();
    expect(screen.getByText("high 2 · medium 1 · low 0 · unattributed 0")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Top model" })).toBeTruthy();
    expect(screen.getByText("gpt-5.2 +1")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /view sessions/i })[0]);

    expect(await screen.findByRole("dialog", { name: "Session details" })).toBeTruthy();
    expect(screen.queryByText("s-001")).toBeNull();
    expect(screen.queryByText("s-002")).toBeNull();
    expect(screen.getAllByText("gpt-5.2").length).toBeGreaterThan(0);
    expect(screen.getByText("Tier A")).toBeTruthy();
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
  });

  it("shows branch and session costs without estimated suffixes while keeping unknown costs as Unknown", async () => {
    render(<BranchesPage />);

    expect(await screen.findByText("Branch cost intelligence")).toBeTruthy();
    expect(screen.getAllByText("$12.34").length).toBe(2);
    expect(screen.queryByText("$12.34 est.")).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: /view sessions/i })[0]);

    expect(await screen.findByText("Session details")).toBeTruthy();
    expect(screen.getAllByText("$9.10").length).toBeGreaterThan(0);
    expect(screen.queryByText("$9.10 est.")).toBeNull();
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
  });

  it("switches projects and applies the branch filter locally", async () => {
    render(<BranchesPage />);

    const projectSelect = await screen.findByRole("combobox", {
      name: copy("branches.project.select_label"),
    });

    expect(screen.queryByText("/repo-a")).toBeNull();

    fireEvent.change(projectSelect, { target: { value: "/repo-b" } });

    await waitFor(() => {
      expect(screen.queryByText("/repo-a")).toBeNull();
      expect(screen.queryByText("feature-a")).toBeNull();
      expect(screen.queryByText("/repo-b")).toBeNull();
      expect(screen.getByText("release-b")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Branch filter"), { target: { value: "release" } });

    await waitFor(() => {
      expect(screen.queryByText("/repo-b")).toBeNull();
      expect(screen.getByText("release-b")).toBeTruthy();
    });
  });

  it("disambiguates duplicate repo basenames in the project selector", async () => {
    getBranchUsage.mockResolvedValueOnce(makePayload([
      {
        repo_root: "/work/acme/app",
        branches: [
          {
            branch: "feature-acme",
            total_tokens: 50,
            total_cost_usd: 1.25,
            session_count: 1,
            last_seen_at: "2026-05-10T11:10:00.000Z",
            confidence: { high: 1, medium: 0, low: 0, unattributed: 0 },
            models: [],
            sessions: [],
          },
        ],
      },
      {
        repo_root: "/tmp/sandbox/app",
        branches: [
          {
            branch: "feature-sandbox",
            total_tokens: 25,
            total_cost_usd: 0.5,
            session_count: 1,
            last_seen_at: "2026-05-09T09:00:00.000Z",
            confidence: { high: 0, medium: 1, low: 0, unattributed: 0 },
            models: [],
            sessions: [],
          },
        ],
      },
    ]));

    render(<BranchesPage />);

    const projectSelect = await screen.findByRole("combobox", {
      name: copy("branches.project.select_label"),
    });
    const options = screen.getAllByRole("option").map((option) => option.textContent);

    expect(options).toContain("/work/acme/app");
    expect(options).toContain("/tmp/sandbox/app");
    expect(projectSelect.value).toBe("/work/acme/app");
    expect(screen.getByText("feature-acme")).toBeTruthy();
    expect(screen.queryByText("feature-sandbox")).toBeNull();
  });

  it("defaults to the latest repo even when payload repos arrive out of order", async () => {
    getBranchUsage.mockResolvedValueOnce(makePayload([
      {
        repo_root: "/repo-older",
        branches: [
          {
            branch: "older-branch",
            total_tokens: 10,
            total_cost_usd: 0.1,
            session_count: 1,
            last_seen_at: "2026-05-07T08:00:00.000Z",
            confidence: { high: 1, medium: 0, low: 0, unattributed: 0 },
            models: [],
            sessions: [],
          },
        ],
      },
      {
        repo_root: "/repo-newer",
        branches: [
          {
            branch: "newer-branch",
            total_tokens: 20,
            total_cost_usd: 0.2,
            session_count: 1,
            last_seen_at: "2026-05-11T08:00:00.000Z",
            confidence: { high: 1, medium: 0, low: 0, unattributed: 0 },
            models: [],
            sessions: [],
          },
        ],
      },
    ]));

    render(<BranchesPage />);

    const projectSelect = await screen.findByRole("combobox", {
      name: copy("branches.project.select_label"),
    });

    expect(projectSelect.value).toBe("/repo-newer");
    expect(screen.queryByText("/repo-newer")).toBeNull();
    expect(screen.getByText("newer-branch")).toBeTruthy();
    expect(screen.queryByText("/repo-older")).toBeNull();
    expect(screen.queryByText("older-branch")).toBeNull();
  });

  it("paginates branch rows at ten rows per page", async () => {
    const branches = Array.from({ length: 12 }, (_, index) => ({
      branch: `branch-${String(index + 1).padStart(2, "0")}`,
      total_tokens: 100 + index,
      total_cost_usd: 0.25 + index,
      session_count: 1,
      last_seen_at: "2026-05-10T11:10:00.000Z",
      confidence: { high: 1, medium: 0, low: 0, unattributed: 0 },
      models: [],
      sessions: [],
    }));
    getBranchUsage.mockResolvedValueOnce(makePayload([
      {
        repo_root: "/repo-many",
        branches,
      },
    ]));

    render(<BranchesPage />);

    expect(await screen.findByText("branch-01")).toBeTruthy();
    expect(screen.getByText("branch-10")).toBeTruthy();
    expect(screen.queryByText("branch-11")).toBeNull();
    expect(screen.getByText("1-10 of 12")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: copy("details.pagination.next") }));

    await waitFor(() => {
      expect(screen.queryByText("branch-01")).toBeNull();
      expect(screen.getByText("branch-11")).toBeTruthy();
      expect(screen.getByText("branch-12")).toBeTruthy();
      expect(screen.getByText("11-12 of 12")).toBeTruthy();
    });
  });
});
