const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildHeatmap,
  buildReadmeBannerData,
  formatCompactTokenCount,
  formatUsd,
} = require("../src/lib/readme-sync/banner-data");
const { buildMonthAnchors, renderReadmeBannerSvg } = require("../src/lib/readme-sync/render-svg");

const MONTH_LABELS = new Set(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);

test("month anchors are derived from week transitions instead of hardcoded positions", () => {
  const anchors = buildMonthAnchors({
    to: "2026-05-12",
    weeks: 52,
    weekStartsOn: "sun",
  });

  assert.ok(anchors.length >= 11);
  assert.ok(anchors.every((entry) => MONTH_LABELS.has(entry.label)));
  assert.equal(new Set(anchors.map((entry) => entry.x)).size, anchors.length);
  for (const [index, entry] of anchors.entries()) {
    assert.equal(entry.x, 46 + entry.weekIndex * 16);
    if (index > 0) {
      assert.ok(entry.weekIndex > anchors[index - 1].weekIndex);
      assert.ok(entry.x > anchors[index - 1].x);
    }
  }
  assert.ok(anchors.at(-1).x > anchors[0].x);
});

test("buildReadmeBannerData uses injected now for heatmap determinism", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibedeck-readme-banner-"));
  const now = new Date(Date.UTC(2020, 1, 15)); // 2020-02-15

  try {
    const data = await buildReadmeBannerData({ home, now });
    assert.equal(data.heatmap.to, "2020-02-15");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("README banner heatmap uses dashboard-style max-relative levels", () => {
  const heatmap = buildHeatmap(
    [
      { hour_start: "2026-05-11T00:00:00.000Z", billable_total_tokens: 100 },
      { hour_start: "2026-05-12T00:00:00.000Z", billable_total_tokens: 400 },
      { hour_start: "2026-05-13T00:00:00.000Z", billable_total_tokens: 800 },
      { hour_start: "2026-05-14T00:00:00.000Z", billable_total_tokens: 1000 },
    ],
    { to: "2026-05-16", weeks: 1, weekStartsOn: "sun" },
  );

  const byDay = new Map(heatmap.weeks.flat().filter(Boolean).map((cell) => [cell.day, cell]));
  assert.equal(heatmap.to, "2026-05-16");
  assert.equal(byDay.get("2026-05-11").level, 1);
  assert.equal(byDay.get("2026-05-12").level, 2);
  assert.equal(byDay.get("2026-05-13").level, 4);
  assert.equal(byDay.get("2026-05-14").level, 4);
  assert.equal(byDay.get("2026-05-14").value, 1000);
});

test("README banner heatmap buckets activity by local timezone day", () => {
  const heatmap = buildHeatmap(
    [
      { hour_start: "2026-05-15T20:00:00.000Z", billable_total_tokens: 100 },
    ],
    { to: "2026-05-16", weeks: 1, weekStartsOn: "sun", timeZone: "Asia/Kolkata" },
  );

  const byDay = new Map(heatmap.weeks.flat().filter(Boolean).map((cell) => [cell.day, cell]));
  assert.equal(byDay.get("2026-05-15").value, 0);
  assert.equal(byDay.get("2026-05-16").value, 100);
  assert.equal(byDay.get("2026-05-16").level, 4);
});

test("buildReadmeBannerData falls back to queue rows when canonical db rows are unavailable", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibedeck-readme-banner-"));
  const trackerDir = path.join(home, ".vibedeck", "tracker");
  fs.mkdirSync(trackerDir, { recursive: true });
  fs.writeFileSync(
    path.join(trackerDir, "queue.jsonl"),
    [
      JSON.stringify({
        source: "codex",
        model: "gpt-5.4",
        hour_start: "2026-05-15T20:00:00.000Z",
        total_tokens: 100,
        billable_total_tokens: 100,
        total_cost_usd: 1,
      }),
      JSON.stringify({
        source: "codex",
        model: "gpt-5.4",
        hour_start: "2026-05-15T20:00:00.000Z",
        total_tokens: 150,
        billable_total_tokens: 150,
        total_cost_usd: 2,
      }),
    ].join("\n") + "\n",
    "utf8",
  );

  try {
    const data = await buildReadmeBannerData({
      home,
      now: new Date("2026-05-16T04:00:00.000Z"),
      timeZone: "Asia/Kolkata",
    });
    const byDay = new Map(data.heatmap.weeks.flat().filter(Boolean).map((cell) => [cell.day, cell]));
    assert.equal(data.totalTokensLabel, "150");
    assert.equal(data.totalCostLabel, "$2");
    assert.equal(byDay.get("2026-05-16").value, 150);
    assert.equal(byDay.get("2026-05-16").level, 4);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("banner formatters keep billions precise and cost rounded to dollars", () => {
  assert.equal(formatCompactTokenCount(2_766_071_694), "2.77B");
  assert.equal(formatCompactTokenCount(768_500_000), "768.5M");
  assert.equal(formatUsd(1944.08), "$1,944");
  assert.equal(formatUsd(1944.89), "$1,945");
});

test("svg renders computed month labels for the visible 52-week window", () => {
  const anchors = buildMonthAnchors({
    to: "2026-05-12",
    weeks: 52,
    weekStartsOn: "sun",
  });

  const svg = renderReadmeBannerSvg({
    updatedDateLabel: "May 12, 2026",
    totalTokensLabel: "12.4M",
    totalTokensSubLabel: "12,400,000 tokens total",
    totalCostLabel: "$184",
    topModels: [
      { name: "claude-opus-4-1", valueLabel: "5.2M", percentLabel: "42%" },
      { name: "gpt-5.4", valueLabel: "3.1M", percentLabel: "25%" },
    ],
    heatmap: {
      to: "2026-05-12",
      weekStartsOn: "sun",
      weeks: Array.from({ length: 52 }, () => Array(7).fill({ level: 0 })),
    },
  });

  for (const anchor of anchors) {
    assert.match(svg, new RegExp(`x="${anchor.x}"[^>]*>${anchor.label}`));
  }
});
