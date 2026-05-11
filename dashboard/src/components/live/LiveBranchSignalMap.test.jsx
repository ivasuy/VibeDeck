/* @vitest-environment jsdom */

import React from "react";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { render } from "../../test/test-utils";
import { LiveBranchSignalMap } from "./LiveBranchSignalMap";

function panelTile(label) {
  return screen.getByText(label).closest(".rounded-md");
}

describe("LiveBranchSignalMap", () => {
  it("counts only real repo branches as routes and separates unrouted sessions", () => {
    render(
      <LiveBranchSignalMap
        sessions={[
          {
            provider: "codex",
            session_id: "routed-low",
            repo_root: "/repo/vibedeck",
            branch: "main",
            confidence: "low",
          },
          {
            provider: "codex",
            session_id: "routed-high",
            repo_root: "/repo/vibedeck",
            branch: "main",
            confidence: "high",
          },
          {
            provider: "codex",
            session_id: "unknown",
            repo_root: null,
            branch: null,
            confidence: "unattributed",
          },
        ]}
      />,
    );

    expect(screen.getByText("1 route")).toBeTruthy();
    expect(within(panelTile("Routed")).getByText("2")).toBeTruthy();
    expect(within(panelTile("Unrouted")).getByText("1")).toBeTruthy();
    expect(within(panelTile("Signals")).getByText("3")).toBeTruthy();
    expect(within(panelTile("Routes")).getByText("1")).toBeTruthy();
  });
});
