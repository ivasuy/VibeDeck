/* @vitest-environment jsdom */

import React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UsageLimitsPanel } from "./UsageLimitsPanel.jsx";

afterEach(() => {
  cleanup();
});

describe("UsageLimitsPanel", () => {
  it("shows provider status rows instead of hiding configured providers with errors", () => {
    render(
      <UsageLimitsPanel
        claude={{ configured: true, error: "Claude API returned 403" }}
        codex={{ configured: false }}
        cursor={{
          configured: true,
          error: null,
          primary_window: { used_percent: 50, reset_at: "2026-05-10T10:39:54.000Z" },
        }}
        order={["claude", "codex", "cursor"]}
      />,
    );

    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("Cursor")).toBeInTheDocument();
    expect(screen.getByText(/Claude API returned 403/)).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByText("Plan")).toBeInTheDocument();
  });

  it("renders Kimi quota windows and not-connected state", () => {
    const { rerender } = render(
      <UsageLimitsPanel
        kimi={{
          configured: true,
          error: null,
          parallel_limit: 20,
          primary_window: { used_percent: 64, reset_at: "2026-05-04T06:02:56.054Z" },
          secondary_window: { used_percent: 4, reset_at: "2026-05-02T05:02:56.054Z" },
          tertiary_window: { used_percent: 1, reset_at: null },
        }}
        order={["kimi"]}
      />,
    );

    expect(screen.getByText("Kimi")).toBeInTheDocument();
    expect(screen.getByText("Weekly")).toBeInTheDocument();
    expect(screen.getByText("5h")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("Parallel: 20")).toBeInTheDocument();
    expect(screen.getByText("64%")).toBeInTheDocument();
    expect(screen.getByText("4%")).toBeInTheDocument();
    expect(screen.getByText("1%")).toBeInTheDocument();

    rerender(<UsageLimitsPanel kimi={{ configured: false }} order={["kimi"]} />);

    expect(screen.getByText("Kimi")).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
  });

  it("renders Claude cooldown guidance without a hard error prefix", () => {
    render(
      <UsageLimitsPanel
        claude={{
          configured: true,
          error: null,
          status: "cooldown",
          retry_after_seconds: 120,
          raw_error: "Claude API rate limited (429). Too many usage checks.",
        }}
        order={["claude"]}
      />,
    );

    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("Rate limited. Try again in 2m.")).toBeInTheDocument();
    expect(screen.queryByText(/Error:/)).not.toBeInTheDocument();
  });

  it("renders Gemini setup-required guidance", () => {
    render(
      <UsageLimitsPanel
        gemini={{
          configured: true,
          error: null,
          status: "setup_required",
          raw_error: "Not logged in to Gemini. Run 'gemini' in Terminal to authenticate.",
        }}
        order={["gemini"]}
      />,
    );

    expect(screen.getByText("Gemini")).toBeInTheDocument();
    expect(screen.getByText("Setup required")).toBeInTheDocument();
    expect(screen.getByText("Authorize Gemini CLI OAuth, then refresh limits.")).toBeInTheDocument();
  });

  it("renders exact token numerator and denominator when the backend supplies them", () => {
    render(
      <UsageLimitsPanel
        codex={{
          configured: true,
          error: null,
          primary_window: {
            used_percent: 92,
            used_tokens: 2_300_000,
            limit_tokens: 2_500_000,
            reset_at: null,
          },
        }}
        order={["codex"]}
      />,
    );

    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("2.3M / 2.5M tokens")).toBeInTheDocument();
  });

  it("renders expanded provider breadth with generic limit windows", () => {
    render(
      <UsageLimitsPanel
        factoryai={{
          configured: true,
          primary_window: { used_percent: 18, reset_at: "2026-05-04T06:02:56.054Z" },
        }}
        hermes={{
          configured: true,
          secondary_window: { used_percent: 33, reset_at: "2026-05-04T06:02:56.054Z" },
        }}
        openclaw={{
          configured: true,
          tertiary_window: { used_percent: 47, reset_at: "2026-05-04T06:02:56.054Z" },
        }}
        opencode={{ configured: false }}
        order={["factoryai", "hermes", "openclaw", "opencode"]}
      />,
    );

    expect(screen.getByText("Factory AI")).toBeInTheDocument();
    expect(screen.getByText("Hermes")).toBeInTheDocument();
    expect(screen.getByText("OpenClaw")).toBeInTheDocument();
    expect(screen.getByText("OpenCode")).toBeInTheDocument();
    expect(screen.getByText("Primary")).toBeInTheDocument();
    expect(screen.getByText("Secondary")).toBeInTheDocument();
    expect(screen.getByText("Tertiary")).toBeInTheDocument();
    expect(screen.getByText("18%")).toBeInTheDocument();
    expect(screen.getByText("33%")).toBeInTheDocument();
    expect(screen.getByText("47%")).toBeInTheDocument();
  });
});
