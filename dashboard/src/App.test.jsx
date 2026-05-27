/* @vitest-environment jsdom */

import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.jsx";
import { LocaleProvider } from "./ui/foundation/LocaleProvider.jsx";

vi.mock("@vercel/analytics/react", () => ({ Analytics: () => null }));
vi.mock("@vercel/speed-insights/react", () => ({ SpeedInsights: () => null }));
vi.mock("./pages/DashboardPage.jsx", () => ({ DashboardPage: () => <div>Usage Page</div> }));
vi.mock("./pages/LivePage.jsx", () => ({ LivePage: () => <div>Live Page</div> }));
vi.mock("./pages/BranchesPage.jsx", () => ({ BranchesPage: () => <div>Branches Page</div> }));
vi.mock("./pages/SettingsPage.jsx", () => ({ SettingsPage: () => <div>Settings Page</div> }));
vi.mock("./pages/SkillsPage.jsx", () => ({ SkillsPage: () => <div>Skills Page</div> }));
vi.mock("./pages/WidgetsPage.jsx", () => ({ WidgetsPage: () => <div>Widgets Page</div> }));
vi.mock("./pages/ComparePage.jsx", () => ({ ComparePage: () => <div>Compare Page</div> }));
vi.mock("./pages/ModelsPage.jsx", () => ({ ModelsPage: () => <div>Models Page</div> }));
vi.mock("./pages/YieldPage.jsx", () => ({ YieldPage: () => <div>Yield Page</div> }));
vi.mock("./pages/ExportPage.jsx", () => ({ ExportPage: () => <div>Export Page</div> }));
vi.mock("./pages/OptimizePage.jsx", () => ({ OptimizePage: () => <div>Optimize Page</div> }));
vi.mock("./pages/PlanPage.jsx", () => ({ PlanPage: () => <div>Plan Page</div> }));
vi.mock("./ui/openai/components/Sidebar.jsx", () => ({
  AppLayout: ({ children }) => <div data-testid="app-layout">{children}</div>,
}));

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

describe("App routes", () => {
  it("renders unknown dashboard routes as the live dashboard", async () => {
    render(
      <MemoryRouter initialEntries={["/unknown"]}>
        <LocaleProvider>
          <App />
        </LocaleProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Live Page")).toBeTruthy();
  });

  it.each([
    ["/compare", "Compare Page"],
    ["/models", "Models Page"],
    ["/yield", "Yield Page"],
    ["/export", "Export Page"],
    ["/optimize", "Optimize Page"],
    ["/plan", "Plan Page"],
  ])("renders the %s route inside the dashboard layout", (route, label) => {
    render(
      <MemoryRouter initialEntries={[route]}>
        <LocaleProvider>
          <App />
        </LocaleProvider>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("app-layout")).toBeTruthy();
    expect(screen.getByText(label)).toBeTruthy();
  });
});
