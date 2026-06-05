/* @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { getCommandPaletteCatalog, getNavGroups } from "./Sidebar.jsx";

describe("sidebar navigation", () => {
  it("does not show the temporarily hidden Entire page", () => {
    const ids = getNavGroups().flatMap((group) => group.items.map((item) => item.id));

    expect(ids).not.toContain("entire");
  });

  it("keeps Dashboard outside the four sidebar lanes", () => {
    const groups = getNavGroups();

    expect(groups.map((group) => group.label)).toEqual(["Live", "Intelligence", "Analytics", "Setup"]);
    expect(groups.find((group) => group.id === "live").items.map((item) => item.id)).toEqual([
      "live",
      "branches",
    ]);
    expect(groups.flatMap((group) => group.items.map((item) => item.id))).not.toContain("dashboard");
  });

  it("exposes dashboard routes through the command palette without Entire", () => {
    const items = getCommandPaletteCatalog();
    const targets = items.map((item) => item.to);
    const labels = items.map((item) => item.label);

    expect(targets).toContain("/dashboard");
    expect(targets).toContain("/live");
    expect(targets).toContain("/settings");
    expect(labels).toContain("Provider limits");
    expect(labels.join(" ")).not.toMatch(/entire/i);
  });
});
