/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { buildActivityHeatmap } from "../../../../lib/activity-heatmap";
import { ThemeContext } from "../../../foundation/ThemeProvider.jsx";
import { render } from "../../../../test/test-utils";
import { ActivityHeatmap } from "../ActivityHeatmap.jsx";

afterEach(() => {
  cleanup();
});

function createHeatmap(weekStartsOn) {
  const end = new Date(Date.UTC(2026, 4, 10));
  const dailyRows = [];

  for (let offset = 0; offset < 52 * 7; offset += 1) {
    const day = new Date(Date.UTC(2026, 4, 10 - offset));
    dailyRows.push({
      day: day.toISOString().slice(0, 10),
      total_tokens: ((offset % 9) + 1) * 100,
    });
  }

  return {
    ...buildActivityHeatmap({
      dailyRows,
      weeks: 52,
      to: end.toISOString().slice(0, 10),
      weekStartsOn,
    }),
    week_starts_on: weekStartsOn,
  };
}

function renderHeatmap(weekStartsOn) {
  return render(
    <ThemeContext.Provider
      value={{
        theme: "light",
        setTheme: () => {},
        toggleTheme: () => {},
        resolvedTheme: "light",
      }}
    >
      <ActivityHeatmap heatmap={createHeatmap(weekStartsOn)} timeZoneShortLabel="UTC" />
    </ThemeContext.Provider>,
  );
}

describe("ActivityHeatmap", () => {
  it("uses translated compact weekday labels for Monday-start 52-week heatmaps", () => {
    renderHeatmap("mon");

    expect(screen.queryAllByText(/heatmap\.day\./i)).toHaveLength(0);
    expect(screen.getByText("Mon")).toBeInTheDocument();
    expect(screen.getByText("Wed")).toBeInTheDocument();
    expect(screen.getByText("Fri")).toBeInTheDocument();
    expect(screen.queryByText("Tue")).not.toBeInTheDocument();
    expect(screen.queryByText("Thu")).not.toBeInTheDocument();
    expect(screen.queryByText("Sat")).not.toBeInTheDocument();
    expect(screen.queryByText("Sun")).not.toBeInTheDocument();
  });

  it("uses translated compact weekday labels for Sunday-start 52-week heatmaps", () => {
    renderHeatmap("sun");

    expect(screen.queryAllByText(/heatmap\.day\./i)).toHaveLength(0);
    expect(screen.getByText("Sun")).toBeInTheDocument();
    expect(screen.getByText("Tue")).toBeInTheDocument();
    expect(screen.getByText("Thu")).toBeInTheDocument();
    expect(screen.getByText("Sat")).toBeInTheDocument();
    expect(screen.queryByText("Mon")).not.toBeInTheDocument();
    expect(screen.queryByText("Wed")).not.toBeInTheDocument();
    expect(screen.queryByText("Fri")).not.toBeInTheDocument();
  });
});
