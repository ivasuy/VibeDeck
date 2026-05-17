'use strict';

const SVG_WIDTH = 900;
const SVG_HEIGHT = 220;
const PROJECT_LABEL_X = 24;
const PROJECT_LABEL_Y = 27;
const TOP_MODELS_X = 472;
const TOP_MODELS_VALUE_X = 840;
const TOP_MODELS_PERCENT_X = 876;
const TOP_MODELS_BASE_Y = [72, 97, 122];
const TOP_MODEL_BAR_Y = [76, 101, 126];
const TOP_MODEL_BAR_WIDTH = 404;
const TOP_MODEL_BAR_HEIGHT = 5;
const TOP_MODEL_ROW_COUNT = 3;
const ZERO_PERCENT = 0;

const BOTTOM_SECTION_Y = 144;
const BOTTOM_SECTION_LINES_Y = 151;
const ACTIVE_DAYS_X = 150;
const INPUT_TOKENS_X = 450;
const OUTPUT_TOKENS_X = 750;
const BOTTOM_LABEL_Y = 165;
const BOTTOM_VALUE_Y = 196;

const BOTTOM_BAR_GRADIENTS = ['gbar1', 'gbar2', 'gbar3'];

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clampPercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return ZERO_PERCENT;
  return Math.max(ZERO_PERCENT, Math.min(100, percent));
}

function parsePercent(row, fallbackTotal = 0, fallbackValue = 0) {
  const rawPercent = row?.percentLabel ?? row?.percent ?? row?.share ?? ZERO_PERCENT;
  if (rawPercent === ZERO_PERCENT) {
    if (fallbackTotal > 0) {
      const value = Number(row?.value) || Number(row?.tokens) || Number(row?.totalTokens) || Number(row?.billable_total_tokens) || ZERO_PERCENT;
      if (value > 0) return clampPercent((value / fallbackTotal) * 100);
      if (fallbackValue > 0) return clampPercent((fallbackValue / fallbackTotal) * 100);
    }
    return ZERO_PERCENT;
  }
  const numeric = Number(String(rawPercent).replace(/%/g, ''));
  return clampPercent(numeric);
}

function renderText(value) {
  return escapeXml(value || '');
}

function renderTokensWithSuffix(value, attrs) {
  const label = String(value);
  const m = label.trim().match(/^([\$\-]?[\d.,]+)\s*([KMBT])$/i);
  if (!m) {
    return `<text ${attrs}>${escapeXml(label)}</text>`;
  }
  return `<text ${attrs}>${escapeXml(m[1])}<tspan font-size="0.62em" dx="1" font-weight="600">${escapeXml(m[2])}</tspan></text>`;
}

function renderTopModelRows(topModels = [], totalFallback = 0) {
  const entries = Array.isArray(topModels) ? topModels : [];
  const rows = [];
  const modelTotal = entries.reduce((sum, row) => {
    const value = Number(row?.value) || Number(row?.tokens) || Number(row?.totalTokens) || Number(row?.billable_total_tokens) || 0;
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  const fallbackTotal = totalFallback > 0 ? totalFallback : modelTotal;

  for (let i = 0; i < TOP_MODEL_ROW_COUNT; i += 1) {
    const row = entries[i];
    const y = TOP_MODELS_BASE_Y[i];
    const barY = TOP_MODEL_BAR_Y[i];
    const bgFillWidth = TOP_MODEL_BAR_WIDTH;
    const gradientId = BOTTOM_BAR_GRADIENTS[i % BOTTOM_BAR_GRADIENTS.length];
    if (!row) {
      rows.push(`<text x="${TOP_MODELS_X}" y="${y}" font-size="10" fill="rgba(200,200,255,0.82)" font-family="system-ui,sans-serif">—</text>`);
      rows.push(`<text x="${TOP_MODELS_VALUE_X}" y="${y}" text-anchor="end" font-size="10" fill="#a5b4fc" font-family="'Courier New',Courier,monospace">0</text>`);
      rows.push(`<text x="${TOP_MODELS_PERCENT_X}" y="${y}" text-anchor="end" font-size="9" fill="rgba(168,168,220,0.45)" font-family="system-ui,sans-serif">0%</text>`);
      rows.push(`<rect x="${TOP_MODELS_X}" y="${barY}" width="${bgFillWidth}" height="${TOP_MODEL_BAR_HEIGHT}" rx="2.5" fill="rgba(99,102,241,0.12)"/>`);
      rows.push(`<rect x="${TOP_MODELS_X}" y="${barY}" width="0" height="${TOP_MODEL_BAR_HEIGHT}" rx="2.5" fill="url(#${gradientId})"/>`);
      continue;
    }

    const name = renderText(row.name || row.model || '—');
    const valueLabel = renderText(row.valueLabel || row.value || row.tokens || 0);
    const percent = parsePercent(
      row,
      fallbackTotal,
      Number(row?.value) || Number(row?.tokens) || Number(row?.totalTokens) || Number(row?.billable_total_tokens) || ZERO_PERCENT,
    );
    const fillWidth = Math.round((percent / 100) * TOP_MODEL_BAR_WIDTH);

    rows.push(`<text x="${TOP_MODELS_X}" y="${y}" font-size="10" fill="rgba(200,200,255,0.82)" font-family="system-ui,sans-serif">${name}</text>`);
    rows.push(`<text x="${TOP_MODELS_VALUE_X}" y="${y}" text-anchor="end" font-size="10" fill="#a5b4fc" font-family="'Courier New',Courier,monospace">${valueLabel}</text>`);
    rows.push(`<text x="${TOP_MODELS_PERCENT_X}" y="${y}" text-anchor="end" font-size="9" fill="rgba(168,168,220,0.45)" font-family="system-ui,sans-serif">${Math.round(percent)}%</text>`);
    rows.push(`<rect x="${TOP_MODELS_X}" y="${barY}" width="${bgFillWidth}" height="${TOP_MODEL_BAR_HEIGHT}" rx="2.5" fill="rgba(99,102,241,0.12)"/>`);
    rows.push(`<rect x="${TOP_MODELS_X}" y="${barY}" width="${fillWidth}" height="${TOP_MODEL_BAR_HEIGHT}" rx="2.5" fill="url(#${gradientId})"/>`);
  }
  return rows.join('\n');
}

function renderProjectReadmeBannerSvg(data = {}) {
  const projectLabel = escapeXml(data.projectLabel || 'Project');
  const updatedDateLabel = escapeXml(data.updatedDateLabel || 'Unknown');
  // Raw labels for the hero values — renderTokensWithSuffix escapes internally
  const totalTokensLabel = data.totalTokensLabel || '0';
  const totalTokensSubLabel = escapeXml(data.totalTokensSubLabel || '0 tokens total');
  const totalCostLabel = escapeXml(data.totalCostLabel || '$0.00');
  const activeDaysLabel = data.activeDaysLabel || '0';
  const inputTokensLabel = data.inputTokensLabel || '0';
  const outputTokensLabel = data.outputTokensLabel || '0';

  const totalTokensValue = Number(data.totalTokensValue) || Number(data.total_tokens) || 0;
  const topModels = Array.isArray(data.topModels) ? data.topModels : [];
  const topModelMarkup = renderTopModelRows(topModels, totalTokensValue);

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
  <linearGradient id="gbottom" x1="0" y1="0" x2="${SVG_WIDTH}" y2="0" gradientUnits="userSpaceOnUse">
    <stop offset="0%" stop-color="rgba(99,102,241,0)"/>
    <stop offset="33%" stop-color="rgba(99,102,241,0.08)"/>
    <stop offset="67%" stop-color="rgba(99,102,241,0.08)"/>
    <stop offset="100%" stop-color="rgba(99,102,241,0)"/>
  </linearGradient>
</defs>

<rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="url(#gbg)" rx="12"/>
<rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="none" stroke="url(#grim)" stroke-width="1" rx="12"/>
<ellipse cx="450" cy="-20" rx="420" ry="70" fill="rgba(99,102,241,0.06)"/>

<text x="${PROJECT_LABEL_X}" y="${PROJECT_LABEL_Y}" font-size="13" font-weight="700" fill="#e8e8ff" font-family="system-ui,sans-serif" letter-spacing="0.2">${projectLabel}</text>
<text x="728" y="27" font-size="8" font-weight="700" fill="rgba(168,168,220,0.28)" font-family="system-ui,sans-serif" letter-spacing="1.8">VIBEDECK</text>
<text x="876" y="27" text-anchor="end" font-size="10" fill="rgba(168,168,220,0.26)" font-family="system-ui,sans-serif">${updatedDateLabel}</text>

<line x1="24" y1="38" x2="876" y2="38" stroke="url(#gdiv)" stroke-width="0.75"/>

<text x="24" y="58" font-size="9" font-weight="600" fill="rgba(168,168,220,0.4)" font-family="system-ui,sans-serif" letter-spacing="1.4">TOTAL TOKENS</text>
<text x="268" y="58" font-size="9" font-weight="600" fill="rgba(168,168,220,0.4)" font-family="system-ui,sans-serif" letter-spacing="1.4">TOTAL COST</text>
<text x="472" y="58" font-size="9" font-weight="600" fill="rgba(168,168,220,0.4)" font-family="system-ui,sans-serif" letter-spacing="1.4">TOP MODELS</text>

${renderTokensWithSuffix(totalTokensLabel, 'x="24" y="91" font-size="21" font-weight="700" fill="url(#gtok)" font-family="\'Courier New\',Courier,monospace"')}
<text x="24" y="110" font-size="11" fill="rgba(168,168,220,0.38)" font-family="system-ui,sans-serif">${totalTokensSubLabel}</text>

<text x="268" y="96" font-size="27" font-weight="700" fill="url(#gcost)" font-family="'Courier New',Courier,monospace">${totalCostLabel}</text>
<text x="268" y="114" font-size="11" fill="rgba(168,168,220,0.38)" font-family="system-ui,sans-serif">all time spend</text>

<line x1="256" y1="48" x2="256" y2="135" stroke="rgba(99,102,241,0.18)" stroke-width="0.75"/>
<line x1="458" y1="48" x2="458" y2="135" stroke="rgba(99,102,241,0.18)" stroke-width="0.75"/>

${topModelMarkup}

<line x1="24" y1="${BOTTOM_SECTION_Y}" x2="876" y2="${BOTTOM_SECTION_Y}" stroke="url(#gdiv)" stroke-width="0.75"/>
<rect x="0" y="${BOTTOM_SECTION_Y}" width="900" height="76" fill="url(#gbottom)" rx="0"/>
<line x1="300" y1="${BOTTOM_SECTION_LINES_Y}" x2="300" y2="212" stroke="rgba(99,102,241,0.12)" stroke-width="0.75"/>
<line x1="600" y1="${BOTTOM_SECTION_LINES_Y}" x2="600" y2="212" stroke="rgba(99,102,241,0.12)" stroke-width="0.75"/>

<text x="${ACTIVE_DAYS_X}" y="${BOTTOM_LABEL_Y}" text-anchor="middle" font-size="9" font-weight="600" fill="rgba(168,168,220,0.35)" font-family="system-ui,sans-serif" letter-spacing="1.2">ACTIVE DAYS</text>
${renderTokensWithSuffix(activeDaysLabel, `x="${ACTIVE_DAYS_X}" y="${BOTTOM_VALUE_Y}" text-anchor="middle" font-size="23" font-weight="700" fill="rgba(165,180,252,0.78)" font-family="'Courier New',Courier,monospace"`)}

<text x="${INPUT_TOKENS_X}" y="${BOTTOM_LABEL_Y}" text-anchor="middle" font-size="9" font-weight="600" fill="rgba(168,168,220,0.35)" font-family="system-ui,sans-serif" letter-spacing="1.2">INPUT TOKENS</text>
${renderTokensWithSuffix(inputTokensLabel, `x="${INPUT_TOKENS_X}" y="${BOTTOM_VALUE_Y}" text-anchor="middle" font-size="23" font-weight="700" fill="rgba(165,180,252,0.78)" font-family="'Courier New',Courier,monospace"`)}

<text x="${OUTPUT_TOKENS_X}" y="${BOTTOM_LABEL_Y}" text-anchor="middle" font-size="9" font-weight="600" fill="rgba(168,168,220,0.35)" font-family="system-ui,sans-serif" letter-spacing="1.2">OUTPUT TOKENS</text>
${renderTokensWithSuffix(outputTokensLabel, `x="${OUTPUT_TOKENS_X}" y="${BOTTOM_VALUE_Y}" text-anchor="middle" font-size="23" font-weight="700" fill="rgba(165,180,252,0.78)" font-family="'Courier New',Courier,monospace"`)}
</svg>
`;
}

module.exports = {
  renderProjectReadmeBannerSvg,
};
