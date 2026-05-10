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

  it("renders a repo card link with repository identity and usage", () => {
    render(<ProjectUsagePanel entries={[entry]} />);

    const card = screen.getByRole("link", { name: /hello/i });
    expect(card.getAttribute("href")).toBe("https://github.com/octo/hello");
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText(/★/)).toBeInTheDocument();
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

    expect(within(screen.getByRole("link", { name: /alpha/i })).getByText(expected)).toBeInTheDocument();
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

    const cards = screen.getAllByRole("link");
    expect(cards[0].getAttribute("href")).toBe("https://github.com/octo/recent");
    expect(cards[1].getAttribute("href")).toBe("https://github.com/octo/older");
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
});
