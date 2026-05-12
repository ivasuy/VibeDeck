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
const WEEKDAY_LABEL_Y = [157, 244, 276];
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
  const windowStart = addUtcDays(windowEnd, -7 * Math.max(1, weekCount - 1));

  const anchors = [];
  let lastMonth = null;
  for (let weekIndex = 0; weekIndex < weekCount; weekIndex++) {
    const weekStart = addUtcDays(windowStart, weekIndex * 7);
    let label = null;
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const date = addUtcDays(weekStart, dayOffset);
      if (date.getUTCDate() !== 1) continue;
      label = MONTHS[date.getUTCMonth()];
      break;
    }

    if (label === null) {
      // If no month start day falls in this week, show the current month label
      // for the visible-aligned first column to preserve range header context.
      label = MONTHS[weekStart.getUTCMonth()];
    }

    if (!label || label === lastMonth) continue;
    const columnX = startX + weekIndex * (cellSize + gap);
    anchors.push({ label, weekIndex, x: columnX });
    lastMonth = label;
  }
  return anchors;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderTopModelLines(topModels = []) {
  const rows = topModels.slice(0, 4);
  const lines = [];
  for (let i = 0; i < 4; i++) {
    const entry = rows[i];
    const name = entry?.name || '—';
    const value = entry?.valueLabel || '0';
    const percent = entry?.percentLabel || '0%';
    const y = 79 + i * 18;
    const rowY = 79 + i * 18;
    lines.push(`<text x="472" y="${rowY}" font-size="11" fill="rgba(168,168,220,0.38)" font-family="system-ui,sans-serif">${escapeXml(name)}</text>`);
    lines.push(`<text x="472" y="${y + 16}" font-size="17" fill="url(#gmodel)" font-family="'Courier New',Courier,monospace">${escapeXml(value)}</text>`);
    lines.push(`<text x="558" y="${y + 16}" font-size="11" fill="rgba(168,168,220,0.5)" font-family="system-ui,sans-serif">${escapeXml(percent)}</text>`);
  }
  return lines;
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
  const totalTokensLabel = escapeXml(data.totalTokensLabel || '0');
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
  <linearGradient id="gmodel" x1="472" y1="0" x2="558" y2="0" gradientUnits="userSpaceOnUse">
    <stop offset="0%" stop-color="#a5b4fc"/>
    <stop offset="100%" stop-color="#818cf8"/>
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
<text x="108" y="27" font-size="11" fill="rgba(168,168,220,0.36)" font-family="system-ui,sans-serif">· AI coding agent usage dashboard</text>
<text x="876" y="27" text-anchor="end" font-size="10" fill="rgba(168,168,220,0.26)" font-family="system-ui,sans-serif">Updated ${updatedDateLabel}</text>

<line x1="24" y1="38" x2="876" y2="38" stroke="url(#gdiv)" stroke-width="0.75"/>

<text x="24" y="58" font-size="9" font-weight="600" fill="rgba(168,168,220,0.4)" font-family="system-ui,sans-serif" letter-spacing="1.4">TOTAL TOKENS</text>
<text x="268" y="58" font-size="9" font-weight="600" fill="rgba(168,168,220,0.4)" font-family="system-ui,sans-serif" letter-spacing="1.4">TOTAL COST</text>
<text x="472" y="58" font-size="9" font-weight="600" fill="rgba(168,168,220,0.4)" font-family="system-ui,sans-serif" letter-spacing="1.4">TOP MODELS</text>

<text x="24" y="91" font-size="21" font-weight="700" fill="url(#gtok)" font-family="'Courier New',Courier,monospace">${totalTokensLabel}</text>
<text x="24" y="114" font-size="11" fill="rgba(168,168,220,0.38)" font-family="system-ui,sans-serif">${totalTokensSubLabel}</text>

<text x="268" y="96" font-size="27" font-weight="700" fill="url(#gcost)" font-family="'Courier New',Courier,monospace">${totalCostLabel}</text>
<text x="268" y="114" font-size="11" fill="rgba(168,168,220,0.38)" font-family="system-ui,sans-serif">all time spend</text>

<line x1="256" y1="48" x2="256" y2="130" stroke="rgba(99,102,241,0.18)" stroke-width="0.75"/>
<line x1="458" y1="48" x2="458" y2="130" stroke="rgba(99,102,241,0.18)" stroke-width="0.75"/>

${renderTopModelLines(topModels).join('\n')}

<line x1="24" y1="138" x2="876" y2="138" stroke="url(#gdiv)" stroke-width="0.75"/>
<text x="24" y="157" font-size="9" font-weight="600" fill="rgba(168,168,220,0.4)" font-family="system-ui,sans-serif" letter-spacing="1.4">ACTIVITY · PAST 52 WEEKS</text>

<text x="42" y="${WEEKDAY_LABEL_Y[0]}" text-anchor="end" font-size="9" fill="rgba(168,168,220,0.36)" font-family="system-ui,sans-serif">Mon</text>
<text x="42" y="${WEEKDAY_LABEL_Y[1]}" text-anchor="end" font-size="9" fill="rgba(168,168,220,0.36)" font-family="system-ui,sans-serif">Wed</text>
<text x="42" y="${WEEKDAY_LABEL_Y[2]}" text-anchor="end" font-size="9" fill="rgba(168,168,220,0.36)" font-family="system-ui,sans-serif">Fri</text>
${renderMonthLabels(heatmap)}
${renderHeatmapWeeks(heatmap)}
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
