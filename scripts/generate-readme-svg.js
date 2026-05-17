#!/usr/bin/env node
/**
 * Generate github-readme-banner.svg from live VibeDeck data.
 *   node scripts/generate-readme-svg.js
 * Falls back to sample data when VibeDeck is not running.
 */
const http = require('node:http');
const fs   = require('node:fs');
const path = require('node:path');

// ── Layout ────────────────────────────────────────────────────────────
const W = 900, H = 320, PAD = 24;

// Stat columns
const C1 = PAD;          // tokens
const DIV1 = 256;
const C2 = 268;          // cost
const DIV2 = 458;
const C3 = 472;          // top models
const RIGHT = W - PAD;  // 876

// Heatmap
const CELL = 13, GAP = 3, COL_W = CELL + GAP; // 16px / col
const WEEKS = 52, DAYS = 7;
const HMX = PAD + 22;   // 46 — cells start x (after day labels)
const HMY = 184;         // cells start y

// Colors (VibeDeck indigo palette)
const HC = ['#17162e', '#2d2a5e', '#4f46a8', '#6366f1', '#a5b4fc'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── API ───────────────────────────────────────────────────────────────
function get(p) {
  return new Promise((ok, fail) => {
    const req = http.get({ host: 'localhost', port: 7690, path: p }, r => {
      let b = '';
      r.on('data', d => (b += d));
      r.on('end', () => { try { ok(JSON.parse(b)); } catch { fail(new Error('bad json')); } });
    });
    req.on('error', fail);
    req.setTimeout(4000, () => { req.destroy(); fail(new Error('timeout')); });
  });
}

async function loadData() {
  const [s, h, m] = await Promise.allSettled([
    get('/functions/vibedeck-usage-summary'),
    get('/functions/vibedeck-usage-heatmap'),
    get('/functions/vibedeck-usage-model-breakdown'),
  ]);
  return {
    summary: s.status === 'fulfilled' ? s.value : {},
    heatmap: h.status === 'fulfilled' ? h.value : {},
    models:  m.status === 'fulfilled' ? m.value : {},
  };
}

// ── Formatting ────────────────────────────────────────────────────────
const fmt     = n => (n == null ? '0' : Number(n).toLocaleString('en-US'));
const fmtCost = n => '$' + (n == null ? '0.00' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const esc     = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// ── Sample heatmap (fallback) ─────────────────────────────────────────
function sampleWeeks() {
  let s = 31337;
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
  return Array.from({ length: WEEKS }, (_, w) =>
    Array.from({ length: DAYS }, (_, d) => {
      const rec  = (w / WEEKS) ** 0.7;
      const wknd = d >= 5 ? 0.3 : 0;
      const raw  = rec * 0.85 + r() * 0.4 - wknd;
      return { level: Math.min(4, Math.max(0, Math.floor(raw * 5))) };
    })
  );
}

// ── SVG: heatmap ──────────────────────────────────────────────────────
function svgHeatmap(weeks) {
  const out = [];

  // Day labels
  ['', 'Mon', '', 'Wed', '', 'Fri', ''].forEach((lbl, d) => {
    if (!lbl) return;
    out.push(`<text x="${HMX - 4}" y="${HMY + d * COL_W + CELL - 1}" text-anchor="end" font-size="9" fill="rgba(168,168,220,0.36)" font-family="system-ui,sans-serif">${lbl}</text>`);
  });

  // Month labels — anchor weeks to Sunday so each column = one calendar week,
  // collect month transitions, then drop any label whose month spans fewer than
  // MIN_SPAN columns (prevents the leading/trailing partial month from colliding
  // with its neighbour, e.g. May/Jun jammed at x=46/x=62).
  const MIN_SPAN = 3;
  const now = new Date();
  const currentSunday = new Date(now);
  currentSunday.setHours(0, 0, 0, 0);
  currentSunday.setDate(currentSunday.getDate() - currentSunday.getDay());

  const colDate = w => {
    const d = new Date(currentSunday);
    d.setDate(d.getDate() - (WEEKS - 1 - w) * 7);
    return d;
  };

  const transitions = [];
  let prevM = -1;
  for (let w = 0; w < WEEKS; w++) {
    const m = colDate(w).getMonth();
    if (m !== prevM) {
      transitions.push({ w, month: m });
      prevM = m;
    }
  }

  transitions.forEach((t, i) => {
    const nextW = i + 1 < transitions.length ? transitions[i + 1].w : WEEKS;
    if (nextW - t.w < MIN_SPAN) return;
    out.push(`<text x="${HMX + t.w * COL_W}" y="${HMY - 9}" font-size="9" fill="rgba(168,168,220,0.36)" font-family="system-ui,sans-serif">${MONTHS[t.month]}</text>`);
  });

  // Cells
  for (let w = 0; w < WEEKS; w++) {
    const wk = weeks[w] || [];
    for (let d = 0; d < DAYS; d++) {
      const cell = wk[d] || { level: 0 };
      const lvl  = Math.min(4, Math.max(0, Number(cell.level) || 0));
      out.push(`<rect x="${HMX + w * COL_W}" y="${HMY + d * COL_W}" width="${CELL}" height="${CELL}" rx="2" fill="${HC[lvl]}"/>`);
    }
  }

  return out.join('\n');
}

// ── SVG: model rows ───────────────────────────────────────────────────
function svgModels(models, total) {
  return models.slice(0, 3).map((m, i) => {
    const name = esc(m.model || m.name || 'Unknown');
    const pct  = m.percentage != null
      ? Number(m.percentage)
      : (total > 0 ? (Number(m.token_count || 0) / total) * 100 : 0);
    const y    = 84 + i * 24;
    const bw   = Math.round((pct / 100) * 180);
    return [
      `<rect x="${C3 + 14}" y="${y - 11}" width="${bw}" height="14" rx="3" fill="rgba(99,102,241,0.14)"/>`,
      `<text x="${C3}" y="${y}" font-size="10" fill="rgba(168,168,220,0.38)" font-family="system-ui,sans-serif">${i + 1}</text>`,
      `<text x="${C3 + 14}" y="${y}" font-size="11" fill="#c8c8f0" font-family="system-ui,sans-serif">${name}</text>`,
      `<text x="${RIGHT}" y="${y}" text-anchor="end" font-size="11" font-weight="600" fill="#818cf8" font-family="'Courier New',Courier,monospace">${pct.toFixed(1)}%</text>`,
    ].join('');
  }).join('\n');
}

// ── Main SVG ──────────────────────────────────────────────────────────
function buildSVG({ summary = {}, heatmap = {}, models = {} }) {
  const tok   = summary.total_tokens || 0;
  const cost  = summary.total_cost   || 0;
  const mods  = models.models || models.breakdown || [];
  const weeks = Array.isArray(heatmap.weeks) && heatmap.weeks.length
    ? heatmap.weeks
    : sampleWeeks();
  const date  = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const legCX = W / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="gbg" x1="0" y1="0" x2="${W}" y2="${H}" gradientUnits="userSpaceOnUse">
    <stop offset="0%" stop-color="#09081a"/>
    <stop offset="100%" stop-color="#0d0b1e"/>
  </linearGradient>
  <linearGradient id="gtok" x1="${C1}" y1="0" x2="${C1 + 200}" y2="0" gradientUnits="userSpaceOnUse">
    <stop offset="0%" stop-color="#d4d4ff"/>
    <stop offset="100%" stop-color="#a5b4fc"/>
  </linearGradient>
  <linearGradient id="gcost" x1="${C2}" y1="0" x2="${C2 + 170}" y2="0" gradientUnits="userSpaceOnUse">
    <stop offset="0%" stop-color="#a5b4fc"/>
    <stop offset="100%" stop-color="#6366f1"/>
  </linearGradient>
  <linearGradient id="gdiv" x1="0" y1="0" x2="${W}" y2="0" gradientUnits="userSpaceOnUse">
    <stop offset="0%"   stop-color="rgba(99,102,241,0)"/>
    <stop offset="25%"  stop-color="rgba(99,102,241,0.22)"/>
    <stop offset="75%"  stop-color="rgba(99,102,241,0.22)"/>
    <stop offset="100%" stop-color="rgba(99,102,241,0)"/>
  </linearGradient>
  <linearGradient id="grim" x1="0" y1="0" x2="${W}" y2="${H}" gradientUnits="userSpaceOnUse">
    <stop offset="0%"   stop-color="rgba(99,102,241,0.28)"/>
    <stop offset="50%"  stop-color="rgba(99,102,241,0.12)"/>
    <stop offset="100%" stop-color="rgba(129,140,248,0.24)"/>
  </linearGradient>
</defs>

<!-- bg + border -->
<rect width="${W}" height="${H}" fill="url(#gbg)" rx="12"/>
<rect width="${W}" height="${H}" fill="none" stroke="url(#grim)" stroke-width="1" rx="12"/>

<!-- ambient glow -->
<ellipse cx="${W / 2}" cy="-20" rx="420" ry="70" fill="rgba(99,102,241,0.06)"/>

<!-- ── Header ──────────────────────────────────────────────────────── -->
<text x="${C1}" y="27" font-size="14" font-weight="700" fill="#e8e8ff" font-family="system-ui,sans-serif" letter-spacing="0.3">VibeDeck</text>
<text x="${C1 + 84}" y="27" font-size="11" fill="rgba(168,168,220,0.36)" font-family="system-ui,sans-serif">· AI coding agent usage dashboard</text>
<text x="${RIGHT}" y="27" text-anchor="end" font-size="10" fill="rgba(168,168,220,0.26)" font-family="system-ui,sans-serif">Updated ${date}</text>

<line x1="${C1}" y1="38" x2="${RIGHT}" y2="38" stroke="url(#gdiv)" stroke-width="0.75"/>

<!-- ── Stats ───────────────────────────────────────────────────────── -->

<!-- labels -->
<text x="${C1}" y="58" font-size="9" font-weight="600" fill="rgba(168,168,220,0.4)" font-family="system-ui,sans-serif" letter-spacing="1.4">TOTAL TOKENS</text>
<text x="${C2}" y="58" font-size="9" font-weight="600" fill="rgba(168,168,220,0.4)" font-family="system-ui,sans-serif" letter-spacing="1.4">TOTAL COST</text>
<text x="${C3}" y="58" font-size="9" font-weight="600" fill="rgba(168,168,220,0.4)" font-family="system-ui,sans-serif" letter-spacing="1.4">TOP MODELS</text>

<!-- values -->
<text x="${C1}" y="91" font-size="21" font-weight="700" fill="url(#gtok)" font-family="'Courier New',Courier,monospace">${fmt(tok)}</text>
<text x="${C1}" y="114" font-size="11" fill="rgba(168,168,220,0.38)" font-family="system-ui,sans-serif">${fmt(tok)} tokens total</text>

<text x="${C2}" y="96" font-size="27" font-weight="700" fill="url(#gcost)" font-family="'Courier New',Courier,monospace">${fmtCost(cost)}</text>
<text x="${C2}" y="114" font-size="11" fill="rgba(168,168,220,0.38)" font-family="system-ui,sans-serif">all time spend</text>

<!-- vertical dividers -->
<line x1="${DIV1}" y1="48" x2="${DIV1}" y2="130" stroke="rgba(99,102,241,0.18)" stroke-width="0.75"/>
<line x1="${DIV2}" y1="48" x2="${DIV2}" y2="130" stroke="rgba(99,102,241,0.18)" stroke-width="0.75"/>

<!-- model rows -->
${svgModels(mods, tok)}

<!-- ── Heatmap section ─────────────────────────────────────────────── -->
<line x1="${C1}" y1="138" x2="${RIGHT}" y2="138" stroke="url(#gdiv)" stroke-width="0.75"/>

<text x="${C1}" y="157" font-size="9" font-weight="600" fill="rgba(168,168,220,0.4)" font-family="system-ui,sans-serif" letter-spacing="1.4">ACTIVITY · PAST 52 WEEKS</text>

${svgHeatmap(weeks)}

<!-- legend -->
<text x="${legCX - 44}" y="${H - 10}" text-anchor="end" font-size="9" fill="rgba(168,168,220,0.3)" font-family="system-ui,sans-serif">Less</text>
${HC.map((c, i) => `<rect x="${legCX - 32 + i * 15}" y="${H - 23}" width="11" height="11" rx="2" fill="${c}"/>`).join('')}
<text x="${legCX + 52}" y="${H - 10}" font-size="9" fill="rgba(168,168,220,0.3)" font-family="system-ui,sans-serif">More</text>

</svg>`;
}

// ── Run ───────────────────────────────────────────────────────────────
async function main() {
  let data;
  try {
    data = await loadData();
    console.log('Loaded live VibeDeck data.');
  } catch (e) {
    console.warn(`VibeDeck offline (${e.message}) — using sample data.`);
    data = {
      summary: { total_tokens: 1854387677, total_cost: 1221.06 },
      heatmap: {},
      models: {
        models: [
          { model: 'gpt-5.5',            percentage: 41.2 },
          { model: 'gpt-5.4',            percentage: 28.4 },
          { model: 'gpt-5.3-codex-spark', percentage: 21.4 },
        ],
      },
    };
  }

  const out = path.resolve(__dirname, '..', 'github-readme-banner.svg');
  fs.writeFileSync(out, buildSVG(data), 'utf8');
  console.log('Written:', out);
}

main().catch(e => { console.error(e); process.exit(1); });
