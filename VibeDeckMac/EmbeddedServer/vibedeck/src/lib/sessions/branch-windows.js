'use strict';

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function parseMs(iso) {
  if (!isNonEmptyString(iso)) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function roundTo4(n) {
  return Math.round(n * 10000) / 10000;
}

function splitSessionByBranchTransitions({ session, transitions } = {}) {
  if (!session || typeof session !== 'object') throw new TypeError('splitSessionByBranchTransitions: session must be an object');
  const startedAt = session.started_at;
  const endedAt = session.ended_at;
  const startMs = parseMs(startedAt);
  const endMs = parseMs(endedAt);
  if (startMs == null || endMs == null) throw new TypeError('splitSessionByBranchTransitions: started_at/ended_at must be valid ISO timestamps');
  if (endMs < startMs) throw new TypeError('splitSessionByBranchTransitions: ended_at must be >= started_at');

  const totalTokens = Number.isFinite(session.total_tokens) ? session.total_tokens : 0;
  const hasKnownCost = Number.isFinite(session.total_cost_usd);
  const totalCost = hasKnownCost ? session.total_cost_usd : null;
  const totalMs = endMs - startMs;

  const baseBranch = isNonEmptyString(session.branch) ? session.branch : null;
  const list = Array.isArray(transitions) ? transitions.slice() : [];
  if (list.length === 0 || totalMs === 0) {
    return [
      {
        branch: baseBranch,
        window_start: startedAt,
        window_end: endedAt,
        prorated_tokens: totalTokens,
        prorated_cost_usd: hasKnownCost ? totalCost : null,
      },
    ];
  }

  list.sort((a, b) => String(a.transitioned_at).localeCompare(String(b.transitioned_at)));

  const cuts = [];
  for (const t of list) {
    const iso = t && t.transitioned_at;
    const ms = parseMs(iso);
    if (ms == null) continue;
    if (ms <= startMs) continue;
    if (ms >= endMs) continue;
    if (cuts.length && ms === cuts[cuts.length - 1].ms) continue;
    cuts.push({ iso, ms, ref_name: t && t.ref_name });
  }

  if (cuts.length === 0) {
    return [
      {
        branch: baseBranch,
        window_start: startedAt,
        window_end: endedAt,
        prorated_tokens: totalTokens,
        prorated_cost_usd: hasKnownCost ? totalCost : null,
      },
    ];
  }

  const boundsIso = [startedAt, ...cuts.map((c) => c.iso), endedAt];
  const boundsMs = [startMs, ...cuts.map((c) => c.ms), endMs];
  const branches = [baseBranch, ...cuts.map((c) => (isNonEmptyString(c.ref_name) ? c.ref_name : null))];

  const windows = [];
  let tokensAssigned = 0;
  let costAssigned = 0;

  for (let i = 0; i < boundsIso.length - 1; i++) {
    const windowStartIso = boundsIso[i];
    const windowEndIso = boundsIso[i + 1];
    const durMs = boundsMs[i + 1] - boundsMs[i];

    let tokens;
    let cost;
    if (i === boundsIso.length - 2) {
      tokens = totalTokens - tokensAssigned;
      cost = hasKnownCost ? totalCost - costAssigned : null;
    } else {
      tokens = Math.round((totalTokens * durMs) / totalMs);
      cost = hasKnownCost ? (totalCost * durMs) / totalMs : null;
    }

    tokensAssigned += tokens;
    if (hasKnownCost) costAssigned += cost;

    windows.push({
      branch: branches[i] ?? null,
      window_start: windowStartIso,
      window_end: windowEndIso,
      prorated_tokens: tokens,
      prorated_cost_usd: hasKnownCost ? roundTo4(cost) : null,
    });
  }

  // Ensure exact token conservation.
  const tokenDelta = totalTokens - windows.reduce((acc, w) => acc + w.prorated_tokens, 0);
  if (tokenDelta !== 0) windows[windows.length - 1].prorated_tokens += tokenDelta;

  // Ensure cost conservation (within float error), last absorbs.
  if (hasKnownCost) {
    const costSum = windows.reduce((acc, w) => acc + w.prorated_cost_usd, 0);
    const costDelta = roundTo4(totalCost - costSum);
    if (costDelta !== 0) windows[windows.length - 1].prorated_cost_usd = roundTo4(windows[windows.length - 1].prorated_cost_usd + costDelta);
  }

  return windows;
}

module.exports = { splitSessionByBranchTransitions };
