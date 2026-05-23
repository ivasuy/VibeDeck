/* @vitest-environment jsdom */

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage.jsx";

const api = vi.hoisted(() => ({
  getAutoDetectedProviders: vi.fn(),
  getCurrencyRates: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  getAutoDetectedProviders: api.getAutoDetectedProviders,
  getCurrencyRates: api.getCurrencyRates,
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
  api.getCurrencyRates.mockReset();
  api.getCurrencyRates.mockResolvedValue({ ok: true, rates: { EUR: 0.92 } });
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

  it("adds a model alias row and persists it to localStorage", () => {
    render(<SettingsPage />);

    fireEvent.change(screen.getByLabelText("Alias"), {
      target: { value: "sonnet-latest" },
    });
    fireEvent.change(screen.getByLabelText("Canonical model"), {
      target: { value: "claude-sonnet-4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add alias" }));

    expect(screen.getByText("sonnet-latest")).toBeTruthy();
    expect(screen.getByText("claude-sonnet-4")).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem("vibedeck.modelAliases.v1"))).toEqual([
      { alias: "sonnet-latest", canonical: "claude-sonnet-4" },
    ]);
  });

  it("persists display currency and states exports keep USD cost columns", () => {
    render(<SettingsPage />);

    expect(screen.getByText("Display currency only. Exports keep USD cost columns.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Display currency"), {
      target: { value: "EUR" },
    });

    expect(window.localStorage.getItem("vibedeck.displayCurrency")).toBe("EUR");
    expect(api.getCurrencyRates).toHaveBeenCalledWith({ currency: "EUR" });
  });
});
