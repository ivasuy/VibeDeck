/* @vitest-environment jsdom */

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage.jsx";

const api = vi.hoisted(() => ({
  getAutoDetectedProviders: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  getAutoDetectedProviders: api.getAutoDetectedProviders,
}));

vi.mock("../components/settings/AppearanceSection.jsx", () => ({
  AppearanceSection: () => <div>Appearance placeholder</div>,
}));

vi.mock("../components/settings/AccountSection.jsx", () => ({
  AccountSection: () => <div>Account placeholder</div>,
}));

vi.mock("../components/settings/MenuBarSection.jsx", () => ({
  MenuBarSection: () => <div>Menu bar placeholder</div>,
  NativeAppFooter: () => null,
}));

vi.mock("../components/LimitsSettingsPanel.jsx", () => ({
  LimitsSettingsPanel: () => <div>Limits placeholder</div>,
}));

vi.mock("../hooks/use-limits-display-prefs.js", () => ({
  useLimitsDisplayPrefs: () => ({}),
}));

beforeEach(() => {
  const values = new Map();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key) => (values.has(key) ? values.get(key) : null),
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, String(value)),
    },
  });
  window.localStorage.clear();
  api.getAutoDetectedProviders.mockReset();
  api.getAutoDetectedProviders.mockResolvedValue({
    ok: true,
    providers: [{ id: "claude", displayName: "Claude", found: true }],
  });
});

describe("SettingsPage", () => {
  it("renders model aliases and provider auto-detect controls", async () => {
    render(<SettingsPage />);

    expect(screen.getByText("Model aliases")).toBeTruthy();
    const scanButton = screen.getByRole("button", { name: "Scan providers" });
    expect(scanButton).toBeTruthy();

    fireEvent.click(scanButton);

    expect(await screen.findByText("Claude")).toBeTruthy();
    expect(screen.getByText("found")).toBeTruthy();
  });
});
