const assert = require("node:assert/strict");
const test = require("node:test");

const { renderProjectReadmeBannerSvg } = require("../src/lib/project-readme-sync/render-svg");

test("renders project banner metadata and required sections", () => {
  const svg = renderProjectReadmeBannerSvg({
    projectLabel: "ivasuy/vibedeck-dashboard",
    updatedDateLabel: "May 14, 2026",
    totalTokensLabel: "142.8M",
    totalTokensSubLabel: "142,832,441 tokens total",
    totalCostLabel: "$89.42",
    activeDaysLabel: "23",
    inputTokensLabel: "89.1M",
    outputTokensLabel: "53.7M",
    topModels: [
      { name: "claude-sonnet-4-6", valueLabel: "68.2M", percentLabel: "48%" },
      { name: "gpt-5.5", valueLabel: "51.4M", percentLabel: "36%" },
      { name: "gemini-2.5-pro", valueLabel: "23.2M", percentLabel: "16%" },
    ],
  });

  assert.match(svg, /<text x="24" y="27"[^>]*>ivasuy\/vibedeck-dashboard</);
  assert.match(svg, /May 14, 2026<\/text>/);
  // Tokens with K/M/B/T suffix render the suffix in a smaller tspan, so the assertion
  // matches the split form (e.g. "142.8" + tspan "M") rather than the inline string.
  assert.match(svg, />142\.8<tspan[^>]*>M<\/tspan><\/text>/);
  assert.match(svg, />142,832,441 tokens total<\/text>/);
  assert.match(svg, />\$89\.42<\/text>/);
  assert.match(svg, />23<\/text>/);
  assert.match(svg, />89\.1<tspan[^>]*>M<\/tspan><\/text>/);
  assert.match(svg, />53\.7<tspan[^>]*>M<\/tspan><\/text>/);
  assert.match(svg, />claude-sonnet-4-6</);
  assert.match(svg, />48%<\/text>/);
  assert.match(svg, /gpt-5\.5/);
  assert.match(svg, /gemini-2\.5-pro/);
  assert.match(svg, /<line x1="24" y1="144" x2="876" y2="144" stroke="url\(#gdiv\)" stroke-width="0.75"\/>/);
  assert.match(svg, /<rect x="0" y="144" width="900" height="76" fill="url\(#gbottom\)" rx="0"\/>/);
  assert.match(svg, /<line x1="300" y1="151" x2="300" y2="212" stroke="rgba\(99,102,241,0\.12\)" stroke-width="0\.75"\/>/);
  assert.match(svg, /<line x1="600" y1="151" x2="600" y2="212" stroke="rgba\(99,102,241,0\.12\)" stroke-width="0\.75"\/>/);
});

test("renders top model bars proportionally from percent labels", () => {
  const svg = renderProjectReadmeBannerSvg({
    topModels: [
      { name: "m1", percentLabel: "50%" },
      { name: "m2", percentLabel: "25%" },
      { name: "m3", percentLabel: "12.5%" },
    ],
  });

  const first = /x="472" y="76" width="(\d+)" height="5"[^>]*fill="url\(#gbar1\)"/.exec(svg);
  const second = /x="472" y="101" width="(\d+)" height="5"[^>]*fill="url\(#gbar2\)"/.exec(svg);
  const third = /x="472" y="126" width="(\d+)" height="5"[^>]*fill="url\(#gbar3\)"/.exec(svg);

  assert.ok(first, "expected first top model bar");
  assert.ok(second, "expected second top model bar");
  assert.ok(third, "expected third top model bar");
  assert.equal(first[1], "202");
  assert.equal(second[1], "101");
  assert.equal(third[1], "51");
});

test("supports zero-state output with safe defaults", () => {
  const svg = renderProjectReadmeBannerSvg();

  assert.ok(!svg.includes("undefined"));
  assert.ok(!svg.includes("NaN"));
  assert.match(svg, /text x="24" y="27"[^>]*>Project<\/text>/);
  assert.match(svg, />0<\/text>/);
  assert.match(svg, /x="472" y="76" width="0" height="5"[^>]*fill="url\(#gbar1\)"/);
  assert.match(svg, /x="472" y="101" width="0" height="5"[^>]*fill="url\(#gbar2\)"/);
  assert.match(svg, /x="472" y="126" width="0" height="5"[^>]*fill="url\(#gbar3\)"/);
  assert.match(svg, /x="150" y="196"[^>]*>0<\/text>/);
});

test("escapes top model names without double-encoding", () => {
  const svg = renderProjectReadmeBannerSvg({
    topModels: [{ name: "a&b", percentLabel: "100%", valueLabel: "1" }],
  });

  assert.ok(!svg.includes("a&amp;amp;b"));
  assert.match(svg, /a&amp;b/);
});
