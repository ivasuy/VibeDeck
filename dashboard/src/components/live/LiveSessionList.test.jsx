/* @vitest-environment jsdom */

import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { render } from "../../test/test-utils";
import { LiveSessionList } from "./LiveSessionList";

describe("LiveSessionList", () => {
  it("prefers backend workstream audit totals over locally rebuilt active rows", () => {
    render(
      <LiveSessionList
        streamStatus="connected"
        selectedKey="codex:active"
        onSelectSession={() => {}}
        sessions={[
          {
            provider: "codex",
            session_id: "active",
            repo_root: "/repo/VibeDeck",
            branch: "main",
            total_tokens: 100,
            total_cost_usd: 0.5,
          },
        ]}
        workstreams={[
          {
            id: "project:vibedeck",
            repo_root: "/repo/VibeDeck",
            branches: ["main", "feature/past"],
            primary_session: { provider: "codex", session_id: "active", model: "gpt-5.5" },
            sessions: [{ provider: "codex", session_id: "active", model: "gpt-5.5" }],
            active_session_count: 1,
            recently_completed_count: 0,
            active_total_tokens: 100,
            active_total_cost_usd: 0.5,
            audit_total_tokens: 1100,
            audit_total_cost_usd: 5.5,
            audit_cost_unknown_count: 0,
            branch_groups: [],
          },
        ]}
      />,
    );

    expect(screen.getByText("1,100")).toBeTruthy();
    expect(screen.getByText("$5.50")).toBeTruthy();
    expect(screen.getByText(/feature\/past, main|main, feature\/past/)).toBeTruthy();
  });

  it("renders repo workstream cards with branch-separated active and recently ended session breakdown", () => {
    const onSelectSession = vi.fn();
    render(
      <LiveSessionList
        streamStatus="connected"
        selectedKey="codex:main-live"
        onSelectSession={onSelectSession}
        sessions={[
          {
            provider: "codex",
            session_id: "main-live",
            repo_root: "/repo/VibeDeck",
            branch: "publish-main",
            confidence: "high",
            branch_resolution_tier: "A",
            model: "gpt-5.5",
            total_tokens: 1000,
            total_cost_usd: 0.5,
            started_at: "2026-05-11T01:00:00.000Z",
            updated_at: "2026-05-11T01:20:00.000Z",
          },
          {
            provider: "codex",
            session_id: "related-ended",
            repo_root: "/repo/VibeDeck",
            branch: "dashboard",
            confidence: "medium",
            branch_resolution_tier: "B",
            model: "gpt-5.3-codex-spark",
            total_tokens: 500,
            total_cost_usd: 0.2,
            started_at: "2026-05-11T01:05:00.000Z",
            updated_at: "2026-05-11T01:10:00.000Z",
            ended_at: "2026-05-11T01:10:00.000Z",
            state: "ended",
          },
        ]}
      />,
    );

    expect(screen.getByText("Active workstreams")).toBeTruthy();
    expect(screen.getByText("1 workstream")).toBeTruthy();
    expect(screen.getByText("VibeDeck")).toBeTruthy();
    expect(screen.getByText(/dashboard, publish-main|publish-main, dashboard/)).toBeTruthy();
    expect(screen.queryByText("Primary session")).toBeNull();
    expect(screen.getByText("Related sessions")).toBeTruthy();
    expect(screen.getByText("Live now")).toBeTruthy();
    expect(screen.getByText("1 stale")).toBeTruthy();
    expect(screen.getByText("1,500")).toBeTruthy();
    expect(screen.getByText("$0.70")).toBeTruthy();

    const workstreamCard = screen.getByRole("button", { name: /select VibeDeck workstream/i });
    expect(workstreamCard.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(workstreamCard);
    expect(onSelectSession).toHaveBeenCalledWith("codex:main-live");

    const breakdownButton = screen.getByRole("button", { name: /view breakdown for VibeDeck/i });
    fireEvent.click(breakdownButton);

    expect(screen.getByRole("dialog", { name: /workstream breakdown/i })).toBeTruthy();
    expect(screen.getByText("Primary session")).toBeTruthy();
    expect(screen.getByText("gpt-5.5")).toBeTruthy();
    expect(screen.getByText("gpt-5.3-codex-spark")).toBeTruthy();

    const relatedRow = screen.getByText("gpt-5.3-codex-spark").closest("button");
    expect(relatedRow).toBeTruthy();
    fireEvent.click(relatedRow);
    expect(onSelectSession).toHaveBeenCalledWith("codex:related-ended");
  });

  it("shows cwd_only workstreams as no-git scope with branch unavailable", () => {
    render(
      <LiveSessionList
        streamStatus="connected"
        selectedKey="codex:nogit"
        onSelectSession={() => {}}
        sessions={[
          {
            provider: "codex",
            session_id: "nogit",
            cwd: "/Users/dev/no-git-project",
            repo_root: null,
            branch: "unattributed",
            confidence: "unattributed",
            branch_resolution_tier: "D",
            model: "gpt-5.5",
            total_tokens: 123,
          },
        ]}
        workstreams={[
          {
            id: "cwd:no-git",
            audit_scope: "cwd_only",
            cwd: "/Users/dev/no-git-project",
            repo_root: null,
            branches: ["unattributed"],
            confidence: "unattributed",
            primary_session: {
              provider: "codex",
              session_id: "nogit",
              model: "gpt-5.5",
              confidence: "unattributed",
            },
            sessions: [{ provider: "codex", session_id: "nogit", model: "gpt-5.5" }],
            active_session_count: 1,
            recently_completed_count: 0,
            active_total_tokens: 123,
            active_total_cost_usd: 0.12,
            audit_total_tokens: 123,
            audit_total_cost_usd: 0.12,
            audit_cost_unknown_count: 0,
            branch_groups: [],
          },
        ]}
      />,
    );

    expect(screen.getByText(/No Git repo/)).toBeTruthy();
    expect(screen.getByText("Branch unavailable")).toBeTruthy();
  });
});
