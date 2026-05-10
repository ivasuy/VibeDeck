/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { screen, within } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "../../../../test/test-utils";
import { ProjectUsageBreakdown } from "../ProjectUsageBreakdown.jsx";

describe("ProjectUsageBreakdown", () => {
  it("renders provider and model rows with tokens and estimated cost labels", () => {
    render(
      <ProjectUsageBreakdown
        providers={[
          {
            provider: "codex",
            total_tokens: 2500,
            estimated_total_cost_usd: 1.25,
            cost_estimated: true,
            models: [
              {
                model: "gpt-5.4",
                total_tokens: 1500,
                estimated_total_cost_usd: 0.75,
                cost_estimated: true,
                session_count: 2,
              },
              {
                model: "gpt-5 mini",
                total_tokens: 1000,
                estimated_total_cost_usd: 0,
                cost_estimated: false,
                session_count: 1,
              },
            ],
          },
        ]}
      />,
    );

    const providerRow = screen.getByRole("listitem", { name: /codex/i });
    expect(within(providerRow).getByText("2,500")).toBeInTheDocument();
    expect(within(providerRow).getByText("$1.25 est.")).toBeInTheDocument();

    const estimatedModelRow = screen.getByRole("listitem", { name: /gpt-5\.4/i });
    expect(within(estimatedModelRow).getByText("1,500")).toBeInTheDocument();
    expect(within(estimatedModelRow).getByText("$0.75 est.")).toBeInTheDocument();
    expect(within(estimatedModelRow).getByText("2 sessions")).toBeInTheDocument();

    const zeroCostModelRow = screen.getByRole("listitem", { name: /gpt-5 mini/i });
    expect(within(zeroCostModelRow).getByText("$0.00")).toBeInTheDocument();
  });

  it("renders em dash for unknown costs", () => {
    render(
      <ProjectUsageBreakdown
        providers={[
          {
            provider: "claude",
            total_tokens: 999,
            estimated_total_cost_usd: null,
            cost_estimated: true,
            models: [
              {
                model: "claude-opus",
                total_tokens: 999,
                estimated_total_cost_usd: null,
                cost_estimated: true,
              },
            ],
          },
        ]}
      />,
    );

    const providerRow = screen.getByRole("listitem", { name: /^claude$/i });
    expect(within(providerRow).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("prefers exact cost when exact and estimated values are both present", () => {
    render(
      <ProjectUsageBreakdown
        providers={[
          {
            provider: "gemini",
            total_tokens: 2200,
            total_cost_usd: 2.2,
            estimated_total_cost_usd: 8.8,
            cost_estimated: false,
            models: [
              {
                model: "gemini-2.5-pro",
                total_tokens: 2200,
                total_cost_usd: 1.1,
                estimated_total_cost_usd: 4.4,
                cost_estimated: false,
              },
            ],
          },
        ]}
      />,
    );

    const providerRow = screen.getByRole("listitem", { name: /^gemini$/i });
    expect(within(providerRow).getByText("$2.20")).toBeInTheDocument();
    expect(within(providerRow).queryByText("$8.80 est.")).toBeNull();

    const modelRow = screen.getByRole("listitem", { name: /^gemini-2\.5-pro$/i });
    expect(within(modelRow).getByText("$1.10")).toBeInTheDocument();
    expect(within(modelRow).queryByText("$4.40 est.")).toBeNull();
  });
});
