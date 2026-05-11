/* @vitest-environment jsdom */

import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { render } from "../../test/test-utils";
import { LiveSessionList } from "./LiveSessionList";

describe("LiveSessionList", () => {
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
    expect(screen.getAllByText("publish-main").length).toBeGreaterThan(0);
    expect(screen.getAllByText("dashboard").length).toBeGreaterThan(0);
    expect(screen.queryByText("Primary session")).toBeNull();
    expect(screen.getByText("Related sessions")).toBeTruthy();
    expect(screen.getByText("1 active")).toBeTruthy();
    expect(screen.getByText("1 stale")).toBeTruthy();
    expect(screen.getByText("1,500")).toBeTruthy();
    expect(screen.getByText("$0.70")).toBeTruthy();

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
});
