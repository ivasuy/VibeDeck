import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach } from "vitest";
import { ThemeContext, ThemeProvider } from "./ThemeProvider.jsx";
import { HeaderThemeMenu } from "../../components/RevampSurfaces.jsx";

function ThemeHarness() {
  const theme = React.useContext(ThemeContext);
  return (
    <button type="button" onClick={() => theme.setTheme(theme.resolvedTheme === "dark" ? "light" : "dark")}>
      {theme.resolvedTheme}
    </button>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    localStorage.clear();
  });

  it("keeps exactly one resolved theme class on the document element", async () => {
    localStorage.setItem("vd-theme", "light");

    await act(async () => {
      render(
        <ThemeProvider>
          <ThemeHarness />
        </ThemeProvider>,
      );
    });

    await waitFor(() => expect(document.documentElement.classList.contains("light")).toBe(true));
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "light" }));
    });

    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("lets the header user menu switch theme with keyboard navigation", async () => {
    localStorage.setItem("vd-theme", "light");

    await act(async () => {
      render(
        <ThemeProvider>
          <HeaderThemeMenu />
        </ThemeProvider>,
      );
    });

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "User menu" }));
    });

    const lightOption = screen.getByRole("menuitemradio", { name: "Light" });
    await waitFor(() => expect(lightOption).toHaveFocus());

    await act(async () => {
      await userEvent.keyboard("{ArrowDown}{Enter}");
    });

    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
    expect(localStorage.getItem("vd-theme")).toBe("dark");
  });
});
