/* @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "../../test/test-utils";
import { EntireCommandCenter } from "./EntireCommandCenter.jsx";

afterEach(() => {
  cleanup();
});

describe("EntireCommandCenter", () => {
  it("renders repo command center, recent repos, and active status", () => {
    const onRecentRepoSelect = vi.fn();
    const onRecentRepoRemove = vi.fn();

    render(
      <EntireCommandCenter
        repoInput="/tmp/project"
        onRepoInputChange={vi.fn()}
        onRepoSubmit={vi.fn()}
        repoSuggestions={["/tmp/project", "/tmp/other"]}
        selectedRepo="/tmp/project"
        onRecentRepoSelect={onRecentRepoSelect}
        onRecentRepoRemove={onRecentRepoRemove}
        repoLoading={false}
        repoError=""
        status={{ state: "active", version: "1.2.3" }}
        statusLoading={false}
        statusError=""
      />,
    );

    expect(screen.getByText("Repo command center")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load recent repo project" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load recent repo other" })).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
  });

  it("removes a recent repo through the pane", () => {
    const onRecentRepoRemove = vi.fn();

    render(
      <EntireCommandCenter
        repoInput="/tmp/project"
        onRepoInputChange={vi.fn()}
        onRepoSubmit={vi.fn()}
        repoSuggestions={["/tmp/project", "/tmp/other"]}
        selectedRepo="/tmp/project"
        onRecentRepoSelect={vi.fn()}
        onRecentRepoRemove={onRecentRepoRemove}
        repoLoading={false}
        repoError=""
        status={null}
        statusLoading={false}
        statusError=""
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove recent repo other" }));

    expect(onRecentRepoRemove).toHaveBeenCalledWith("/tmp/other");
  });
});
