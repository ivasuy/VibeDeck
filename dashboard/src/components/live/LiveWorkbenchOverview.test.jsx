/* @vitest-environment jsdom */

import React from "react";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { render } from "../../test/test-utils";
import { LiveWorkbenchOverview } from "./LiveWorkbenchOverview";

function tileFor(label) {
  const labelNode = screen.getByText(label);
  return labelNode.closest(".rounded-lg");
}

describe("LiveWorkbenchOverview", () => {
  it("shows active-session totals separately from active-project audit totals", () => {
    render(
      <LiveWorkbenchOverview
        status="connected"
        sessions={[
          {
            provider: "codex",
            session_id: "active",
            repo_root: "/repo/vibedeck",
            branch: "main",
            confidence: "high",
            total_tokens: 100,
            estimated_total_cost_usd: 0.5,
            cost_quality: "estimated_total_tokens",
          },
        ]}
        totals={{
          active_sessions: 1,
          active_tokens: 100,
          active_cost_usd: 0.5,
          audit_tokens: 1100,
          audit_cost_usd: 5.5,
          active_projects: 1,
        }}
        workstreams={[
          {
            id: "project:vibedeck",
            audit_total_tokens: 1100,
            audit_total_cost_usd: 5.5,
            active_total_tokens: 100,
            active_total_cost_usd: 0.5,
          },
        ]}
        limits={{}}
      />,
    );

    expect(screen.getByText("Project total")).toBeTruthy();
    expect(screen.getByText("Live now")).toBeTruthy();
    expect(screen.getByText("$5.50")).toBeTruthy();
    expect(screen.getAllByText("$0.50").length).toBeGreaterThan(0);
  });

  it("counts attribution gaps, limit sources, and active repos separately", () => {
    const { container } = render(
      <LiveWorkbenchOverview
        status="connected"
        sessions={[
          {
            provider: "codex",
            session_id: "routed-low",
            repo_root: "/repo/vibedeck",
            branch: "main",
            confidence: "low",
            total_tokens: 1000,
            estimated_total_cost_usd: 0.5,
            cost_quality: "estimated_total_tokens",
          },
          {
            provider: "codex",
            session_id: "missing-repo",
            repo_root: null,
            branch: null,
            confidence: "unattributed",
            total_tokens: 2000,
            estimated_total_cost_usd: 1,
            cost_quality: "estimated_total_tokens",
          },
          {
            provider: "claude",
            session_id: "routed-high",
            repo_root: "/repo/switchyard",
            branch: "publish-main",
            confidence: "high",
            total_tokens: 3000,
            estimated_total_cost_usd: 1.5,
            cost_quality: "estimated_total_tokens",
          },
        ]}
        limits={{
          codex: { configured: true, primary_window: { used_percent: 10 } },
          claude: { configured: true, five_hour: { used_percent: 20 } },
        }}
        totals={{ active_projects: 2 }}
      />,
    );

    expect(within(tileFor("Needs attribution")).getByText("1")).toBeTruthy();
    expect(within(tileFor("Limit sources")).getByText("2")).toBeTruthy();
    expect(within(tileFor("Active projects")).getByText("2")).toBeTruthy();
    expect(screen.getAllByText("$3.00").length).toBeGreaterThan(0);
    expect(container.querySelector('[data-counter-root="true"]')).not.toBeNull();
  });

  it("does not count cwd_only sessions as attribution gaps", () => {
    render(
      <LiveWorkbenchOverview
        status="connected"
        sessions={[
          {
            provider: "codex",
            session_id: "cwd-only",
            cwd: "/Users/dev/no-git-project",
            repo_root: null,
            branch: null,
            confidence: "unattributed",
            total_tokens: 100,
            estimated_total_cost_usd: 0.1,
            cost_quality: "estimated_total_tokens",
            audit_scope: "cwd_only",
          },
          {
            provider: "codex",
            session_id: "missing-session-only",
            cwd: null,
            repo_root: null,
            branch: null,
            confidence: "unattributed",
            total_tokens: 100,
            estimated_total_cost_usd: 0.1,
            cost_quality: "estimated_total_tokens",
            audit_scope: "session_only",
          },
        ]}
      />,
    );

    expect(within(tileFor("Needs attribution")).getByText("1")).toBeTruthy();
  });
});
