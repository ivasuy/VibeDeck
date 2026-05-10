/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "../../../test/test-utils";
import {
  ConfidenceBar,
  CostTokenPair,
  EmptyStatePanel,
  IconBadge,
  MetricStrip,
  MiniBarChart,
  ProjectIdentity,
  ProviderModelChips,
} from "../index.js";

afterEach(() => cleanup());

describe("ops UI primitives", () => {
  it("renders a labeled icon badge without decorative text overflow", () => {
    render(<IconBadge accent="live" label="Live" />);
    expect(screen.getByLabelText("Live")).toBeInTheDocument();
  });

  it("renders metric strip items with stable labels and values", () => {
    render(
      <MetricStrip
        items={[
          { key: "projects", label: "Projects", value: "3", accent: "project" },
          { key: "cost", label: "Cost", value: "$12.50", accent: "cost" },
        ]}
      />,
    );
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("$12.50")).toBeInTheDocument();
  });

  it("renders provider and model chips with provider icons", () => {
    render(
      <ProviderModelChips
        items={[
          { provider: "codex", model: "gpt-5.4", total_tokens: 1200 },
          { provider: "claude", model: "claude-sonnet-4-6", total_tokens: 800 },
        ]}
      />,
    );
    expect(screen.getByText("gpt-5.4")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-4-6")).toBeInTheDocument();
  });

  it("renders confidence distribution with accessible summary", () => {
    render(
      <ConfidenceBar
        confidence={{ high: 2, medium: 1, low: 3, unattributed: 4 }}
        ariaLabel="Branch confidence distribution"
      />,
    );
    expect(screen.getByLabelText("Branch confidence distribution")).toBeInTheDocument();
    expect(screen.getByText("high 2")).toBeInTheDocument();
  });

  it("renders mini bar chart rows sorted by value", () => {
    render(
      <MiniBarChart
        ariaLabel="Cost by branch"
        rows={[
          { key: "main", label: "main", value: 10, valueLabel: "$10.00" },
          { key: "feature", label: "feature", value: 25, valueLabel: "$25.00" },
        ]}
      />,
    );
    const rows = screen.getAllByTestId("mini-bar-row");
    expect(rows[0]).toHaveTextContent("feature");
    expect(rows[1]).toHaveTextContent("main");
  });

  it("renders project identity with basename and full path title", () => {
    render(<ProjectIdentity repoRoot="/Users/vasuyadav/Downloads/Projects/VibeDeck" />);
    expect(screen.getByText("VibeDeck")).toBeInTheDocument();
    expect(screen.getByTitle("/Users/vasuyadav/Downloads/Projects/VibeDeck")).toBeInTheDocument();
  });

  it("renders cost and token pair with estimate suffix", () => {
    render(<CostTokenPair cost={12.5} tokens={123456} estimated />);
    expect(screen.getByText("$12.50 est.")).toBeInTheDocument();
    expect(screen.getByText("123,456")).toBeInTheDocument();
  });

  it("renders empty state with an icon label and action slot", () => {
    render(
      <EmptyStatePanel
        accent="skills"
        title="No skills"
        description="Install a skill to continue."
        action={<button type="button">Browse</button>}
      />,
    );
    expect(screen.getByText("No skills")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Browse" })).toBeInTheDocument();
  });
});
