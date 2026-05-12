'use strict';

const execa = require('execa');

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function parseUtcIsoOrNull(v) {
  if (!isNonEmptyString(v)) return null;
  const ms = new Date(v).getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function utcFromReflogSelector(selector) {
  if (!isNonEmptyString(selector)) return null;
  const m = selector.match(/\{([^}]+)\}/);
  if (!m) return null;
  // git may emit e.g. 2026-05-09T10:05:00Z (no offset) or with offset depending on format.
  return parseUtcIsoOrNull(m[1]);
}

function isFullSha(v) {
  return typeof v === 'string' && /^[a-f0-9]{40}$/i.test(v.trim());
}

async function _git(repoRoot, args) {
  return execa('git', ['-C', repoRoot, ...args], { stdio: 'pipe' });
}

async function _reflogLines(repoRoot) {
  // Must run exactly per spec (even if %gI is unsupported by the user's git version).
  const primary = await _git(repoRoot, ['reflog', 'show', '--date=iso-strict', '--format=%gd|%gs|%gI|%ad', 'HEAD']);
  const lines = primary.stdout.trim() ? primary.stdout.trim().split('\n') : [];
  if (lines.length === 0) return { lines: [], shas: [] };

  const parsed = lines.map((line) => {
    const parts = line.split('|');
    return {
      raw: line,
      selector: parts[0] || '',
      subject: parts[1] || '',
      shaField: parts[2] || '',
      dateField: parts[3] || '',
    };
  });

  const needsFallback = parsed.some((p) => !isFullSha(p.shaField));
  if (!needsFallback) return { lines: parsed, shas: parsed.map((p) => p.shaField.trim()) };

  const shaOut = await _git(repoRoot, ['reflog', 'show', '--format=%H', 'HEAD']);
  const shaLines = shaOut.stdout.trim() ? shaOut.stdout.trim().split('\n') : [];
  const shas = parsed.map((p, i) => {
    const candidate = (shaLines[i] || '').trim();
    return isFullSha(candidate) ? candidate : p.shaField.trim();
  });
  return { lines: parsed, shas };
}

async function resolveBranchTierC({ repoRoot, when } = {}) {
  if (!isNonEmptyString(repoRoot)) throw new TypeError('resolveBranchTierC: repoRoot must be a non-empty string');
  if (!isNonEmptyString(when)) throw new TypeError('resolveBranchTierC: when must be a non-empty ISO string');

  const whenUtc = parseUtcIsoOrNull(when);
  if (!whenUtc) throw new TypeError('resolveBranchTierC: when must be a valid ISO timestamp');

  let reflog;
  try {
    reflog = await _reflogLines(repoRoot);
  } catch (err) {
    const msg = err && err.stderr ? String(err.stderr) : String(err && err.message ? err.message : err);
    // Zero-commit repos often error on HEAD ambiguity; treat as empty reflog.
    if (msg.includes('unknown revision or path not in the working tree') || msg.includes('ambiguous argument') || msg.includes('bad revision')) {
      return null;
    }
    return null;
  }

  if (!reflog.lines || reflog.lines.length === 0) return null;

  let bestIdx = -1;
  let bestUtc = null;
  for (let i = 0; i < reflog.lines.length; i++) {
    const entry = reflog.lines[i];
    // `%ad` in reflog pretty formats is the commit author date, not the reflog timestamp.
    // Prefer the timestamp embedded in `%gd` (reflog selector) and fall back to `%ad` only if needed.
    const utc = utcFromReflogSelector(entry.selector) || parseUtcIsoOrNull(entry.dateField);
    if (!utc) continue;
    if (utc <= whenUtc && (bestUtc == null || utc >= bestUtc)) {
      bestUtc = utc;
      bestIdx = i;
    }
  }
  if (bestIdx === -1) return null;

  const fullSha = (reflog.shas[bestIdx] || '').trim();
  if (!isFullSha(fullSha)) return null;

  let name;
  try {
    const res = await _git(repoRoot, ['name-rev', '--name-only', fullSha]);
    name = res.stdout.trim();
  } catch {
    name = 'undefined';
  }

  let branch = name;
  if (!isNonEmptyString(branch) || branch === 'undefined') {
    branch = `detached@${fullSha.slice(0, 7)}`;
  }

  return { branch, confidence: 'low' };
}

module.exports = { resolveBranchTierC };
