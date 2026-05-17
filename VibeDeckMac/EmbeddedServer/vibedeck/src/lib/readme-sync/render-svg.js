'use strict';

const { writeFileAtomic } = require('../fs');

const SVG_WIDTH = 900;
const SVG_HEIGHT = 320;
const HEADER_X = 24;
const HEATMAP_LEFT = 46;
const CELL_SIZE = 13;
const CELL_GAP = 3;
const MONTH_Y = 175;
const WEEKDAY_X = 46;
const WEEKDAY_Y = [184, 200, 216, 232, 248, 264, 280];
const WEEKDAY_LABEL_Y = [212, 244, 276];
const MODEL_ROW_YS = [73, 97, 121];
const MODEL_BAR_YS = [77, 101, 125];
const MODEL_BAR_WIDTH = 358;
const MODEL_BAR_HEIGHT = 4;
const MODEL_BAR_GRADIENTS = ['gbar1', 'gbar2', 'gbar3'];
const MODEL_ROW_COUNT = 3;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HEAT_COLORS = [
  '#17162e',
  '#2a2750',
  '#403f7f',
  '#5757c8',
  '#7f7fff',
];

function formatDateUTC(date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  ).toISOString().slice(0, 10);
}

function parseDateString(rawDate) {
  if (typeof rawDate !== 'string') return null;
  const trimmed = rawDate.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month, day));
  if (!Number.isFinite(parsed.getTime())) return null;
  return formatDateUTC(parsed) === trimmed ? parsed : null;
}

function addUtcDays(date, days) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function clipNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

// Drop a month label if its visible run is shorter than this many columns —
// kills the partial leading/trailing month that visually collides with its
// neighbour (e.g. last-week-of-May jammed next to first-week-of-Jun).
const MIN_MONTH_SPAN_COLS = 3;
// Hard pixel floor between consecutive emitted labels, independent of cell
// width. 28px comfortably clears three-letter month names at font-size 9.
const MIN_LABEL_GAP_PX = 28;
// Approximate rendered width of a three-letter uppercase month label; used to
// keep the right-most label from overflowing the heatmap grid.
const LABEL_TEXT_PX = 18;

function buildMonthAnchors({
  to,
  weeks,
  weekStartsOn = 'sun',
  cellSize = CELL_SIZE,
  gap = CELL_GAP,
  startX = HEATMAP_LEFT,
}) {
  const base = parseDateString(String(to || '')) || new Date();
  const toDate = parseDateString(formatDateUTC(base)) || new Date();
  const desired = weekStartsOn === 'mon' ? 1 : 0;
  const delta = (toDate.getUTCDay() - desired + 7) % 7;
  const windowEnd = addUtcDays(toDate, -delta);
  const weekCount = Math.max(1, Math.max(Number(weeks) || 1, 1));
  const windowStart = addUtcDays(windowEnd, -7 * Math.max(0, weekCount - 1));
  const colWidth = cellSize + gap;
  const rightBoundPx = startX + weekCount * colWidth;

  // Pass 1 — every month transition with the column it starts on. Each column
  // is uniquely owned by the calendar month of its anchor day (Sunday for
  // weekStartsOn=sun) so future years, leap years, and month rollovers all
  // resolve without special-casing.
  const transitions = [];
  let lastMonth = null;
  for (let weekIndex = 0; weekIndex < weekCount; weekIndex++) {
    const weekStart = addUtcDays(windowStart, weekIndex * 7);
    const month = weekStart.getUTCMonth();
    if (month === lastMonth) continue;
    transitions.push({ month, year: weekStart.getUTCFullYear(), weekIndex });
    lastMonth = month;
  }

  // Pass 2 — keep transitions whose run is wide enough to read, then enforce a
  // pixel-distance floor and right-edge clamp so labels can never overlap.
  const anchors = [];
  let lastX = Number.NEGATIVE_INFINITY;
  for (let t = 0; t < transitions.length; t++) {
    const cur = transitions[t];
    const nextWeekIndex = t + 1 < transitions.length
      ? transitions[t + 1].weekIndex
      : weekCount;
    if (nextWeekIndex - cur.weekIndex < MIN_MONTH_SPAN_COLS) continue;

    const columnX = startX + cur.weekIndex * colWidth;
    if (columnX - lastX < MIN_LABEL_GAP_PX) continue;
    if (columnX + LABEL_TEXT_PX > rightBoundPx) continue;

    anchors.push({ label: MONTHS[cur.month], weekIndex: cur.weekIndex, x: columnX });
    lastX = columnX;
  }
  return anchors;
}

function buildActivityRangeLabel(heatmap) {
  const base = parseDateString(String(heatmap?.to || '')) || new Date();
  const toDate = parseDateString(formatDateUTC(base)) || new Date();
  const desired = (heatmap?.week_starts_on || heatmap?.weekStartsOn || 'sun') === 'mon' ? 1 : 0;
  const delta = (toDate.getUTCDay() - desired + 7) % 7;
  const windowEnd = addUtcDays(toDate, -delta);
  const weekCount = Math.max(1, Array.isArray(heatmap?.weeks) ? heatmap.weeks.length : 52);
  const windowStart = addUtcDays(windowEnd, -7 * Math.max(0, weekCount - 1));

  // Match the label-drop rule: if the leading month has fewer than MIN span
  // weeks visible, advance the range to the first fully-shown month so the
  // heading agrees with what the user actually sees in the grid.
  const startMonth = windowStart.getUTCMonth();
  let weeksInStart = 0;
  for (let i = 0; i < weekCount; i++) {
    const d = addUtcDays(windowStart, i * 7);
    if (d.getUTCMonth() !== startMonth) break;
    weeksInStart++;
  }
  const labelStart = weeksInStart < MIN_MONTH_SPAN_COLS
    ? addUtcDays(windowStart, weeksInStart * 7)
    : windowStart;

  const fmt = (d) => `${MONTHS[d.getUTCMonth()].toUpperCase()} ${d.getUTCFullYear()}`;
  return `${fmt(labelStart)} — ${fmt(windowEnd)}`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MODEL_NAME_X = 472;
const MODEL_VALUE_X = 800;
const MODEL_PERCENT_X = 836;
const MODEL_NAME_MAX_CHARS = 32;

function parsePercentNumber(rawPercent) {
  if (rawPercent == null) return 0;
  const numeric = Number(String(rawPercent).replace(/%/g, ''));
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, numeric));
}

const SCALE_ORDER = ['K', 'M', 'B', 'T'];
const SCALE_LABEL_PATTERN = /^([$-]?)([\d.,]+)\s*([KMBT])$/i;

// Presentation-only scale escalator. Pure render concern — never mutates the
// data layer. If upstream emits "1850B" because formatCompactTokenCount caps
// at B, we read it as 1.85T for display so future trillion-scale numbers
// don't grow unbounded suffixes.
function escalateScaledLabel(label) {
  const match = String(label).trim().match(SCALE_LABEL_PATTERN);
  if (!match) return label;
  const [, sign, digitsRaw, unitRaw] = match;
  const digits = Number(digitsRaw.replace(/,/g, ''));
  if (!Number.isFinite(digits)) return label;
  let idx = SCALE_ORDER.indexOf(unitRaw.toUpperCase());
  if (idx < 0) return label;
  let value = digits;
  while (value >= 1000 && idx < SCALE_ORDER.length - 1) {
    value /= 1000;
    idx += 1;
  }
  // Decimals chosen so the number stays at most 4 chars wide ("999"/"99.9"/"9.99").
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const formatted = value.toFixed(decimals).replace(/\.?0+$/, '');
  return `${sign}${formatted}${SCALE_ORDER[idx]}`;
}

// Render scaled tokens with a SAME-SIZE suffix — no shrink-tspan. The unit
// letter inherits the parent font-size so "4.67B" reads as one cohesive
// figure instead of digits with a tiny superscript.
function renderTokensWithSuffix(value, attrs) {
  return `<text ${attrs}>${escapeXml(escalateScaledLabel(value))}</text>`;
}

function renderTopModelLines(topModels = []) {
  const rows = topModels.slice(0, MODEL_ROW_COUNT);
  const lines = [];
  for (let i = 0; i < MODEL_ROW_COUNT; i++) {
    const entry = rows[i];
    const y = MODEL_ROW_YS[i];
    const barY = MODEL_BAR_YS[i];
    const gradientId = MODEL_BAR_GRADIENTS[i % MODEL_BAR_GRADIENTS.length];
    lines.push(`<rect x="${MODEL_NAME_X}" y="${barY}" width="${MODEL_BAR_WIDTH}" height="${MODEL_BAR_HEIGHT}" rx="2" fill="rgba(99,102,241,0.12)"/>`);
    if (entry) {
      const raw = String(entry.name || '—');
      const displayName = raw.length > MODEL_NAME_MAX_CHARS
        ? raw.slice(0, MODEL_NAME_MAX_CHARS - 2) + '…'
        : raw;
      const value = String(entry.valueLabel || '0');
      const percent = String(entry.percentLabel || '0%');
      const pct = parsePercentNumber(percent);
      const fillWidth = Math.round((pct / 100) * MODEL_BAR_WIDTH);
      lines.push(`<rect x="${MODEL_NAME_X}" y="${barY}" width="${fillWidth}" height="${MODEL_BAR_HEIGHT}" rx="2" fill="url(#${gradientId})"/>`);
      lines.push(`<text x="${MODEL_NAME_X}" y="${y}" font-size="10" fill="url(#gmodel)" font-family="system-ui,sans-serif">${escapeXml(displayName)}</text>`);
      const valueAttrs = `x="${MODEL_VALUE_X}" y="${y}" text-anchor="end" font-size="10" fill="#a5b4fc" font-family="'Courier New',Courier,monospace"`;
      lines.push(renderTokensWithSuffix(value, valueAttrs));
      lines.push(`<text x="${MODEL_PERCENT_X}" y="${y}" text-anchor="end" font-size="9" fill="rgba(168,168,220,0.45)" font-family="system-ui,sans-serif">${escapeXml(percent)}</text>`);
    } else {
      lines.push(`<text x="${MODEL_NAME_X}" y="${y}" font-size="10" fill="rgba(168,168,220,0.22)" font-family="system-ui,sans-serif">—</text>`);
    }
  }
  return lines;
}

function renderLegend() {
  const legendTextY = 307;
  const squareY = 297;
  const startX = 76;
  const gap = 12;
  const squares = HEAT_COLORS.map(
    (fill, i) => `<rect x="${startX + i * gap}" y="${squareY}" width="9" height="9" rx="1" fill="${fill}"/>`,
  ).join('\n');
  return [
    `<text x="46" y="${legendTextY}" font-size="8" fill="rgba(168,168,220,0.36)" font-family="system-ui,sans-serif">Less</text>`,
    squares,
    `<text x="${startX + HEAT_COLORS.length * gap + 2}" y="${legendTextY}" font-size="8" fill="rgba(168,168,220,0.36)" font-family="system-ui,sans-serif">More</text>`,
  ].join('\n');
}

function renderHeatmapWeeks(heatmap) {
  const weeks = Array.isArray(heatmap?.weeks) ? heatmap.weeks : [];
  const expectedWeeks = Math.max(0, Math.max(weeks.length, 0));
  const rendered = [];
  for (let weekIndex = 0; weekIndex < expectedWeeks; weekIndex++) {
    const week = weeks[weekIndex];
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const cell = week?.[dayIndex] || { level: 0 };
      const level = clipNumber(cell.level, 0, 4);
      const x = HEATMAP_LEFT + weekIndex * (CELL_SIZE + CELL_GAP);
      const y = WEEKDAY_Y[dayIndex];
      const fill = HEAT_COLORS[Math.trunc(level)] || HEAT_COLORS[0];
      rendered.push(
        `<rect x="${x}" y="${y}" width="${CELL_SIZE}" height="${CELL_SIZE}" rx="2" fill="${fill}"/>`,
      );
    }
  }
  return rendered.join('\n');
}

function renderMonthLabels(heatmap) {
  const anchors = buildMonthAnchors({
    to: heatmap?.to,
    weeks: Array.isArray(heatmap?.weeks) ? heatmap.weeks.length : 52,
    weekStartsOn: heatmap?.week_starts_on || heatmap?.weekStartsOn || 'sun',
  });
  return anchors
    .map(
      (anchor) =>
        `<text x="${anchor.x}" y="${MONTH_Y}" font-size="9" fill="rgba(168,168,220,0.36)" font-family="system-ui,sans-serif">${escapeXml(
          anchor.label,
        )}</text>`,
    )
    .join('\n');
}

function renderReadmeBannerSvg(data = {}) {
  const updatedDateLabel = escapeXml(data.updatedDateLabel || 'Unknown');
  // Raw label — renderTokensWithSuffix escapes internally so we don't double-escape the tspan
  const totalTokensLabel = data.totalTokensLabel || '0';
  const totalTokensSubLabel = escapeXml(data.totalTokensSubLabel || '0 tokens total');
  const totalCostLabel = escapeXml(data.totalCostLabel || '$0.00');
  const topModels = Array.isArray(data.topModels) ? data.topModels : [];
  const heatmap = data.heatmap || { weeks: [], to: new Date().toISOString().slice(0, 10), weekStartsOn: 'sun' };

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}">
<defs>
  <linearGradient id="gbg" x1="0" y1="0" x2="${SVG_WIDTH}" y2="${SVG_HEIGHT}" gradientUnits="userSpaceOnUse">
    <stop offset="0%" stop-color="#09081a"/>
    <stop offset="100%" stop-color="#0d0b1e"/>
  </linearGradient>
  <linearGradient id="gtok" x1="24" y1="0" x2="224" y2="0" gradientUnits="userSpaceOnUse">
    <stop offset="0%" stop-color="#d4d4ff"/>
    <stop offset="100%" stop-color="#a5b4fc"/>
  </linearGradient>
  <linearGradient id="gcost" x1="268" y1="0" x2="438" y2="0" gradientUnits="userSpaceOnUse">
    <stop offset="0%" stop-color="#a5b4fc"/>
    <stop offset="100%" stop-color="#6366f1"/>
  </linearGradient>
  <linearGradient id="gmodel" x1="472" y1="0" x2="700" y2="0" gradientUnits="userSpaceOnUse">
    <stop offset="0%" stop-color="#a5b4fc"/>
    <stop offset="100%" stop-color="#818cf8"/>
  </linearGradient>
  <linearGradient id="gbar1" x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox">
    <stop offset="0%" stop-color="#6366f1"/>
    <stop offset="100%" stop-color="#818cf8"/>
  </linearGradient>
  <linearGradient id="gbar2" x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox">
    <stop offset="0%" stop-color="#4E529C"/>
    <stop offset="100%" stop-color="#6366f1"/>
  </linearGradient>
  <linearGradient id="gbar3" x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox">
    <stop offset="0%" stop-color="#818cf8"/>
    <stop offset="100%" stop-color="#a5b4fc"/>
  </linearGradient>
  <linearGradient id="gdiv" x1="0" y1="0" x2="${SVG_WIDTH}" y2="0" gradientUnits="userSpaceOnUse">
    <stop offset="0%" stop-color="rgba(99,102,241,0)"/>
    <stop offset="25%" stop-color="rgba(99,102,241,0.22)"/>
    <stop offset="75%" stop-color="rgba(99,102,241,0.22)"/>
    <stop offset="100%" stop-color="rgba(99,102,241,0)"/>
  </linearGradient>
  <linearGradient id="grim" x1="0" y1="0" x2="${SVG_WIDTH}" y2="${SVG_HEIGHT}" gradientUnits="userSpaceOnUse">
    <stop offset="0%" stop-color="rgba(99,102,241,0.28)"/>
    <stop offset="50%" stop-color="rgba(99,102,241,0.12)"/>
    <stop offset="100%" stop-color="rgba(129,140,248,0.24)"/>
  </linearGradient>
</defs>

<rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="url(#gbg)" rx="12"/>
<rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="none" stroke="url(#grim)" stroke-width="1" rx="12"/>
<ellipse cx="${SVG_WIDTH / 2}" cy="-20" rx="420" ry="70" fill="rgba(99,102,241,0.06)"/>

<text x="${HEADER_X}" y="27" font-size="14" font-weight="700" fill="#e8e8ff" font-family="system-ui,sans-serif" letter-spacing="0.3">VibeDeck</text>
<text x="876" y="27" text-anchor="end" font-size="10" fill="rgba(168,168,220,0.26)" font-family="system-ui,sans-serif">Updated ${updatedDateLabel}</text>

<line x1="24" y1="38" x2="876" y2="38" stroke="url(#gdiv)" stroke-width="0.75"/>

<text x="24" y="58" font-size="9" font-weight="600" fill="rgba(168,168,220,0.4)" font-family="system-ui,sans-serif" letter-spacing="1.4">TOTAL TOKENS</text>
<text x="268" y="58" font-size="9" font-weight="600" fill="rgba(168,168,220,0.4)" font-family="system-ui,sans-serif" letter-spacing="1.4">TOTAL COST</text>
<text x="472" y="58" font-size="9" font-weight="600" fill="rgba(168,168,220,0.4)" font-family="system-ui,sans-serif" letter-spacing="1.4">TOP MODELS</text>

${renderTokensWithSuffix(totalTokensLabel, 'x="24" y="91" font-size="21" font-weight="700" fill="url(#gtok)" font-family="\'Courier New\',Courier,monospace"')}
<text x="24" y="114" font-size="11" fill="rgba(168,168,220,0.38)" font-family="system-ui,sans-serif">${totalTokensSubLabel}</text>

<text x="268" y="96" font-size="27" font-weight="700" fill="url(#gcost)" font-family="'Courier New',Courier,monospace">${totalCostLabel}</text>
<text x="268" y="114" font-size="11" fill="rgba(168,168,220,0.38)" font-family="system-ui,sans-serif">all time spend</text>

<line x1="256" y1="48" x2="256" y2="130" stroke="rgba(99,102,241,0.18)" stroke-width="0.75"/>
<line x1="458" y1="48" x2="458" y2="130" stroke="rgba(99,102,241,0.18)" stroke-width="0.75"/>

${renderTopModelLines(topModels).join('\n')}

<line x1="24" y1="138" x2="876" y2="138" stroke="url(#gdiv)" stroke-width="0.75"/>
<text x="${HEATMAP_LEFT}" y="157" font-size="9" font-weight="600" fill="rgba(168,168,220,0.4)" font-family="system-ui,sans-serif" letter-spacing="1.4">ACTIVITY · ${escapeXml(buildActivityRangeLabel(heatmap))}</text>

<text x="42" y="${WEEKDAY_LABEL_Y[0]}" text-anchor="end" font-size="9" fill="rgba(168,168,220,0.36)" font-family="system-ui,sans-serif">Mon</text>
<text x="42" y="${WEEKDAY_LABEL_Y[1]}" text-anchor="end" font-size="9" fill="rgba(168,168,220,0.36)" font-family="system-ui,sans-serif">Wed</text>
<text x="42" y="${WEEKDAY_LABEL_Y[2]}" text-anchor="end" font-size="9" fill="rgba(168,168,220,0.36)" font-family="system-ui,sans-serif">Fri</text>
${renderMonthLabels(heatmap)}
${renderHeatmapWeeks(heatmap)}
${renderLegend()}
</svg>
`;
}

async function writeReadmeBannerSvg(filePath, data) {
  const svg = renderReadmeBannerSvg(data);
  await writeFileAtomic(filePath, `${svg}\n`);
  return svg;
}

module.exports = {
  buildMonthAnchors,
  renderReadmeBannerSvg,
  writeReadmeBannerSvg,
};
