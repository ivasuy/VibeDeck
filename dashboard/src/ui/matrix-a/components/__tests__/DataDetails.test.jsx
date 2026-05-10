/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "../../../../test/test-utils";
import { DataDetails } from "../DataDetails.jsx";

const copyMap = {
  "dashboard.daily.title": "Daily Breakdown",
  "dashboard.projects.title": "Project Usage",
  "dashboard.projects.limit_top_3": "TOP 3",
  "dashboard.projects.limit_top_6": "TOP 6",
  "dashboard.projects.limit_top_10": "TOP 10",
  "dashboard.projects.worktrees_label": "Worktrees",
  "dashboard.projects.tokens_label": "Tokens",
  "dashboard.projects.cost_label": "Cost",
  "dashboard.projects.providers_label": "Providers",
  "dashboard.projects.models_label": "Models",
};

function copy(key) {
  return copyMap[key] || key;
}

afterEach(() => {
  cleanup();
});

describe("DataDetails project tab", () => {
  it("renders each project as a metric card with provider model progress rows", async () => {
    const user = userEvent.setup();
    render(
      <DataDetails
        copy={copy}
        projectEntries={[
          {
            project_key: "VibeDeck",
            project_ref: "/Users/vasuyadav/Downloads/Projects/VibeDeck",
            branch_count: 2,
            total_tokens: "242400602",
            estimated_total_cost_usd: "24.5",
            cost_estimated: true,
            providers: [
              {
                provider: "codex",
                models: [
                  {
                    model: "gpt-5.4",
                    total_tokens: "200000000",
                    estimated_total_cost_usd: "20.25",
                    cost_estimated: true,
                  },
                ],
              },
              {
                provider: "claude",
                models: [
                  {
                    model: "claude-sonnet-4-6",
                    total_tokens: "42400602",
                    estimated_total_cost_usd: "4.25",
                    cost_estimated: true,
                  },
                ],
              },
            ],
          },
        ]}
        projectLimit={3}
        dailyBreakdownRows={[]}
        dailyBreakdownColumns={[]}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Project Usage" }));

    expect(screen.getByText("VibeDeck")).toBeInTheDocument();
    expect(screen.getByText("Worktrees")).toBeInTheDocument();
    expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("242,400,602")).toBeInTheDocument();
    expect(screen.getByText("$24.50")).toBeInTheDocument();
    expect(screen.getByText("codex")).toBeInTheDocument();
    expect(screen.getByText("claude")).toBeInTheDocument();
    expect(screen.getByText("gpt-5.4")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-4-6")).toBeInTheDocument();
    expect(screen.getByText("$20.25")).toBeInTheDocument();
    expect(screen.getByText("$4.25")).toBeInTheDocument();
    expect(screen.getByText("82.5%")).toBeInTheDocument();
    expect(screen.getByText("17.5%")).toBeInTheDocument();
  });
});
