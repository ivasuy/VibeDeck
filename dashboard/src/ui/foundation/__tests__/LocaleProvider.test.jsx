import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useLocale } from "../../../hooks/useLocale.js";
import { EN_LOCALE } from "../../../lib/locale";
import { LocaleProvider } from "../LocaleProvider.jsx";

function Probe() {
  const { locale, resolvedLocale } = useLocale();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="resolved">{resolvedLocale}</span>
    </div>
  );
}

describe("LocaleProvider", () => {
  it("provides English locale only", () => {
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );

    expect(screen.getByTestId("locale")).toHaveTextContent(EN_LOCALE);
    expect(screen.getByTestId("resolved")).toHaveTextContent(EN_LOCALE);
  });
});
