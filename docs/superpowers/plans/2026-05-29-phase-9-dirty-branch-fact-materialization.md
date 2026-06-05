# Phase 9 Dirty Branch-Fact Materialization Plan

**Branch:** `agent/rebuild-flush-repair-optimization`
**Worktree:** `.worktrees/rebuild-flush-repair-optimization`
**Base:** `c26502b`

## Context

After defaulting rebuilds to dirty post-drain, the live DB rebuild measured `17.93s`.
The remaining dominant profile stage is:

- `branch_fact_rebuild_pass`: `8100.361ms`
- `dirty_branch_facts_rebuilt`: `126`

The branch-fact pass can re-read provider JSONL branch evidence after the session flush path already read the same evidence into the shared rebuild cache. The strict read used during session processing and the non-strict read used during branch-fact materialization have separate cache keys, so safe unambiguous strict results are not reused.

## Task Graph

### P9-T1-provider-branch-evidence-cache-reuse

**Title:** Reuse unambiguous strict provider branch evidence for non-strict branch-fact materialization.

**Files:**
- `src/lib/sessions/provider-branch.js`
- `test/sessions-branch-usage-facts.test.js`
- `test/sync-rebuild-vibedeck-db.test.js`
- `PROJECT.md`
- `agent-runs/rebuild-flush-repair-optimization/audit/phase-9-report.md`

**Instructions:**
- When `readProviderBranchEvidenceFromSessionFile({ strictMalformed: false })` is called with a shared cache, reuse the cached strict result only if that strict result is not ambiguous.
- Do not reuse ambiguous strict results because non-strict parsing intentionally ignores malformed lines and may recover a valid branch.
- Add regression coverage proving branch-fact rebuilds reuse a strict cached provider-branch result without rescanning the file.
- Add rebuild-level coverage proving the shared cache feeds both grouped flush and dirty branch-fact rebuild.
- Preserve provider-log honesty, ambiguous/malformed behavior, historical unknown behavior, GitHub unknown behavior, and canonical parity.

**Acceptance:**
- Repeated strict -> non-strict evidence reads for the same provider/session return from cache when safe.
- Ambiguous strict reads do not poison non-strict recovery.
- Focused branch-fact and rebuild tests pass.
- Live DB rebuild is measured after the change.

**Checks:**
- `node --test test/sessions-branch-usage-facts.test.js test/sync-rebuild-vibedeck-db.test.js`
- `node --test test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js`
- `node -c src/lib/sessions/provider-branch.js`
- `git diff --check`

### P9-T2-project-attribution-cache

**Title:** Cache project attribution classification during dirty branch-fact materialization.

**Files:**
- `src/lib/sessions/branch-usage-facts.js`
- `test/sessions-branch-usage-facts.test.js`
- `PROJECT.md`
- `agent-runs/rebuild-flush-repair-optimization/audit/phase-9-report.md`

**Instructions:**
- Add a shared `projectAttributionByShape` cache under the existing rebuild cache object.
- Reuse `classifyProjectAttribution` results for repeated project shapes within branch-fact rebuilds.
- Key the cache with provider/session fallback data plus cwd/repo fields so unattributed rows remain session-specific.
- Preserve existing branch attribution behavior, including missing cwd, non-git projects, GitHub unknown, historical unknown, and provider-log branches.

**Acceptance:**
- Repeated same-project events do not re-run filesystem project classification per event.
- Existing branch-fact tests and rebuild parity tests pass.
- Live DB rebuild is measured after the change.
