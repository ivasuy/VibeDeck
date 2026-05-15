/* @vitest-environment jsdom */

import React from "react";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "../../test/test-utils";
import { EntireControlPanel } from "./EntireControlPanel.jsx";

afterEach(() => {
  cleanup();
});

describe("EntireControlPanel", () => {
  it("renders the empty state when no repo is selected", () => {
    render(<EntireControlPanel />);

    expect(screen.getByText("Controls")).toBeTruthy();
    expect(screen.getByText("Select a repo to manage Entire controls.")).toBeTruthy();
  });

  it("renders grouped control sections when a repo is selected", () => {
    render(<EntireControlPanel repo="/tmp/project" onActionSuccess={vi.fn()} />);

    expect(screen.getByText("Controls")).toBeTruthy();
    expect(screen.getByText("Agents and status")).toBeTruthy();
    expect(screen.getByText("Configure")).toBeTruthy();
    expect(screen.getByText("Maintenance")).toBeTruthy();
  });
});
