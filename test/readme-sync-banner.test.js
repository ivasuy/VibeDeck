const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildReadmeBannerData } = require("../src/lib/readme-sync/banner-data");
const { buildMonthAnchors, renderReadmeBannerSvg } = require("../src/lib/readme-sync/render-svg");

test("month anchors are derived from week transitions instead of hardcoded positions", () => {
  const anchors = buildMonthAnchors({
    to: "2026-05-12",
    weeks: 52,
    weekStartsOn: "sun",
  });

  assert.ok(anchors.length >= 11);
  assert.equal(anchors[0].label, "May");
  const june = anchors.find((entry) => entry.label === "Jun");
  assert.ok(june, "expected Jun anchor");
  assert.equal(june.x, 78);
  assert.ok(anchors.at(-1).x > anchors[0].x);
});

test("buildReadmeBannerData uses injected now for heatmap determinism", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vibedeck-readme-banner-"));
  const now = new Date(Date.UTC(2020, 1, 15)); // 2020-02-15

  try {
    const data = await buildReadmeBannerData({ home, now });
    assert.equal(data.heatmap.to, "2020-02-09");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
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
    totalCostLabel: "$184.21",
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

  const june = anchors.find((entry) => entry.label === "Jun");
  assert.ok(june, "expected Jun anchor");
  assert.match(svg, />May</);
  assert.match(svg, />Jun</);
  assert.match(svg, />Apr</);
  assert.match(svg, new RegExp(`x="${june.x}"[^>]*>Jun`));
});
