/* @vitest-environment jsdom */

import React from "react";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { render } from "../../test/test-utils";
import { LiveProviderLimitsGrid } from "./LiveProviderLimitsGrid";

describe("LiveProviderLimitsGrid", () => {
  it("renders expanded provider breadth with generic limit windows", () => {
    render(
      <LiveProviderLimitsGrid
        sessions={[
          { provider: "hermes", session_id: "h1" },
          { provider: "open-code", session_id: "o1" },
        ]}
        limits={{
          hermes: {
            configured: true,
            primary_window: { used_percent: 44, reset_at: "2026-05-27T12:00:00.000Z" },
          },
          opencode: {
            configured: true,
            primary_window: { utilization: 72, resets_at: "2026-05-27T13:00:00.000Z" },
          },
          openclaw: {
            configured: true,
            secondary_window: { used_percent: 18, reset_at: "2026-05-27T14:00:00.000Z" },
          },
          factoryai: {
            configured: true,
            tertiary_window: { used_percent: 8, reset_at: "2026-05-27T15:00:00.000Z" },
          },
        }}
      />,
    );

    expect(screen.getByText("Hermes")).toBeTruthy();
    expect(screen.getByText("OpenCode")).toBeTruthy();
    expect(screen.getByText("OpenClaw")).toBeTruthy();
    expect(screen.getByText("Factory AI")).toBeTruthy();
    expect(screen.getAllByText("Primary").length).toBeGreaterThan(0);
    expect(screen.getByText("Secondary")).toBeTruthy();
    expect(screen.getByText("Tertiary")).toBeTruthy();
  });
});
