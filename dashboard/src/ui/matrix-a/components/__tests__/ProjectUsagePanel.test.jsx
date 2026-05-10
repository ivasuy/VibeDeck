/* @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "../../../../lib/copy";
import { formatCompactNumber } from "../../../../lib/format";
import { render } from "../../../../test/test-utils";
import { ProjectUsagePanel } from "../ProjectUsagePanel.jsx";

describe("ProjectUsagePanel", () => {
  const entry = {
    project_key: "octo/hello",
    project_ref: "https://github.com/octo/hello",
    total_tokens: 12345,
  };

  beforeEach(() => {
    document.documentElement.classList.add("screenshot-capture");
  });

  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove("screenshot-capture");
    vi.unstubAllGlobals();
  });

  it("renders a repo card with repository identity, usage, and explicit GitHub link", () => {
    render(<ProjectUsagePanel entries={[entry]} />);

    const card = screen.getByRole("button", {
      name: copy("dashboard.projects.expand_project", { project: "hello" }),
    });
    const githubLink = screen.getByRole("link", { name: copy("dashboard.projects.github_link_aria", { project: "hello" }) });
    expect(githubLink.getAttribute("href")).toBe("https://github.com/octo/hello");
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText(/★/)).toBeInTheDocument();
    expect(screen.getByText(copy("dashboard.projects.cost_label"))).toBeInTheDocument();
    expect(card).toBeInTheDocument();
  });

  it("prefers total tokens when billable tokens are zero", () => {
    const entryWithBillableZero = {
      project_key: "octo/alpha",
      project_ref: "https://github.com/octo/alpha",
      total_tokens: 12345,
      billable_total_tokens: 0,
    };

    render(<ProjectUsagePanel entries={[entryWithBillableZero]} />);

    const expected = formatCompactNumber("12345", {
      thousandSuffix: copy("shared.unit.thousand_abbrev"),
      millionSuffix: copy("shared.unit.million_abbrev"),
      billionSuffix: copy("shared.unit.billion_abbrev"),
      decimals: 1,
    });

    expect(
      within(
        screen.getByRole("button", {
          name: copy("dashboard.projects.expand_project", { project: "alpha" }),
        }),
      ).getByText(expected),
    ).toBeInTheDocument();
  });

  it("closes the limit popup on Escape", async () => {
    const limitAria = copy("dashboard.projects.limit_aria");
    const onLimitChange = vi.fn();
    const user = userEvent.setup();

    render(<ProjectUsagePanel entries={[entry]} onLimitChange={onLimitChange} />);

    await act(async () => {
      await user.click(screen.getByLabelText(limitAria));
    });
    expect(screen.getByRole("listbox", { name: limitAria })).toBeVisible();

    await act(async () => {
      await user.keyboard("{Escape}");
    });
    expect(screen.queryByRole("listbox", { name: limitAria })).not.toBeInTheDocument();
  });

  it("preserves backend order and shows last used metadata", () => {
    render(
      <ProjectUsagePanel
        limit={2}
        entries={[
          {
            project_key: "octo/recent",
            project_ref: "https://github.com/octo/recent",
            total_tokens: 50,
            last_seen_at: "2026-05-10T11:45:00.000Z",
          },
          {
            project_key: "octo/older",
            project_ref: "https://github.com/octo/older",
            total_tokens: 100,
            last_seen_at: "2026-05-02T09:00:00.000Z",
          },
        ]}
      />,
    );

    const cards = screen.getAllByRole("button");
    expect(cards[0]).toHaveAccessibleName(
      copy("dashboard.projects.expand_project", { project: "recent" }),
    );
    expect(cards[1]).toHaveAccessibleName(
      copy("dashboard.projects.expand_project", { project: "older" }),
    );
    expect(screen.getAllByText(/last used/i)).toHaveLength(2);
  });

  it("does not fetch GitHub stars for non-GitHub project refs", async () => {
    document.documentElement.classList.remove("screenshot-capture");
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        json: async () => ({ stargazers_count: 42 }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ProjectUsagePanel
        entries={[
          {
            project_key: "acme/internal-app",
            project_ref: "https://gitlab.com/acme/internal-app",
            total_tokens: 123,
            last_seen_at: "2026-05-10T11:45:00.000Z",
          },
        ]}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("expands in place to show provider and model breakdown with estimated cost and top model hint", async () => {
    const user = userEvent.setup();
    const expandLabel = copy("dashboard.projects.expand_project", { project: "usage-heavy" });
    const collapseLabel = copy("dashboard.projects.collapse_project", { project: "usage-heavy" });
    render(
      <ProjectUsagePanel
        entries={[
          {
            project_key: "octo/usage-heavy",
            project_ref: "https://github.com/octo/usage-heavy",
            total_tokens: 5000,
            branch_count: 2,
            estimated_total_cost_usd: 12.5,
            cost_estimated: true,
            top_models: [
              {
                provider: "codex",
                model: "gpt-5.4",
                total_tokens: 4000,
              },
            ],
            providers: [
              {
                provider: "codex",
                total_tokens: 5000,
                estimated_total_cost_usd: 12.5,
                cost_estimated: true,
                models: [
                  {
                    model: "gpt-5.4",
                    total_tokens: 4000,
                    estimated_total_cost_usd: 10,
                    cost_estimated: true,
                    session_count: 3,
                  },
                ],
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText("$12.50 est.")).toBeInTheDocument();
    expect(screen.getAllByText(/gpt-5\.4/).length).toBeGreaterThan(0);
    expect(screen.getByText(copy("dashboard.projects.branches_label"))).toBeInTheDocument();
    expect(screen.getByText(copy("dashboard.projects.providers_label"))).toBeInTheDocument();
    expect(screen.getByText(copy("dashboard.projects.models_label"))).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("3 sessions")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: expandLabel })).toHaveAttribute("aria-expanded", "false");

    await act(async () => {
      await user.click(screen.getByRole("button", { name: expandLabel }));
    });

    expect(screen.getByRole("button", { name: collapseLabel })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(copy("dashboard.projects.breakdown_heading"))).toBeInTheDocument();
    expect(screen.getByLabelText(copy("dashboard.projects.breakdown_provider_mix_aria", { project: "usage-heavy" }))).toBeInTheDocument();
    expect(screen.getByText("3 sessions")).toBeInTheDocument();
    expect(screen.getAllByText("$12.50 est.").length).toBeGreaterThan(0);
  });

  it("renders unknown and exact-zero project costs correctly", () => {
    render(
      <ProjectUsagePanel
        entries={[
          {
            project_key: "octo/unknown-cost",
            project_ref: "https://github.com/octo/unknown-cost",
            total_tokens: 100,
            estimated_total_cost_usd: null,
            cost_estimated: true,
          },
          {
            project_key: "octo/zero-cost",
            project_ref: "https://github.com/octo/zero-cost",
            total_tokens: 0,
            estimated_total_cost_usd: 0,
            cost_estimated: false,
          },
        ]}
      />,
    );

    expect(
      within(
        screen.getByRole("button", {
          name: copy("dashboard.projects.expand_project", { project: "unknown-cost" }),
        }),
      ).getAllByText("—").length,
    ).toBeGreaterThan(0);
    expect(
      within(
        screen.getByRole("button", {
          name: copy("dashboard.projects.expand_project", { project: "zero-cost" }),
        }),
      ).getByText("$0.00"),
    ).toBeInTheDocument();
  });

  it("prefers exact project cost when exact and estimated costs are both present", () => {
    render(
      <ProjectUsagePanel
        entries={[
          {
            project_key: "octo/exact-cost",
            project_ref: "https://github.com/octo/exact-cost",
            total_tokens: 1000,
            total_cost_usd: 4.5,
            estimated_total_cost_usd: 9.75,
            cost_estimated: false,
          },
        ]}
      />,
    );

    const card = screen.getByRole("button", {
      name: copy("dashboard.projects.expand_project", { project: "exact-cost" }),
    });
    expect(within(card).getByText("$4.50")).toBeInTheDocument();
    expect(within(card).queryByText("$9.75 est.")).toBeNull();
  });
});
