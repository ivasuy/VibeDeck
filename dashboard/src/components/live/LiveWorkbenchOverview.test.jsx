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
      />,
    );

    expect(within(tileFor("Needs attribution")).getByText("1")).toBeTruthy();
    expect(within(tileFor("Limit sources")).getByText("2")).toBeTruthy();
    expect(within(tileFor("Active repos")).getByText("2")).toBeTruthy();
    expect(screen.getByText("$3.00")).toBeTruthy();
    expect(container.querySelector('[data-counter-root="true"]')).not.toBeNull();
  });
});
