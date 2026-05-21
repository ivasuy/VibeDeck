/* @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { getNavGroups } from "./Sidebar.jsx";

describe("sidebar navigation", () => {
  it("does not show the temporarily hidden Entire page", () => {
    const ids = getNavGroups().flatMap((group) => group.items.map((item) => item.id));

    expect(ids).not.toContain("entire");
  });
});
