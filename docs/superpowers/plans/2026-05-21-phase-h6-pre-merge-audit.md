# Phase H.6 Pre-Merge Audit

**Date:** 2026-05-21 IST
**Branch audited:** `agent/phase-h6-repair-resolve-cache`
**Worktree audited:** `.worktrees/phase-h6-repair-resolve-cache`
**Scope:** H.6 merge readiness on this machine before merging to the release branch. This audit checks rebuild speed, local serve readiness, API data availability, SQLite health, `/usage`, `/dashboard`, `/branches`, Unknown branch, Historical unknown, and the H.7 follow-up experiment status.
**Out of scope:** Merging H.6, accepting H.7, or fixing the remaining `recent_lane_session_event_flush` bottleneck.

## Verdict Up Front

H.6 is still a useful release-branch candidate, but it is not a full rebuild-speed solution.

The local rebuild completed and promoted successfully in `249.396s`, under the `300s` wall-clock gate. The main H.6 target, repair repo resolution, is solved on this corpus: `repair_pass` is `1.015s` versus the H.5 `37.711s` baseline. The strict summary result is now `fail` because `branch_fact_rebuild_pass` reran at `26.291s`, which is `390ms` slower than the H.5 baseline target of `25.900s`. That is a micro-regression in a non-primary gate, not a data-loss failure.

Data integrity checks passed: SQLite `quick_check` is `ok`, `/usage`, `/dashboard`, and `/branches` APIs returned 200, May usage includes Codex and Claude, and Unknown/Historical unknown data remains present. The source worktree initially could not serve UI until `dashboard/dist` was built. After `npm --prefix dashboard ci` and `npm run dashboard:build`, repeated `serve --no-sync` readiness was `570ms` with endpoint latencies from `7ms` to `76ms`.

H.7 should not be folded into this merge candidate. It tried to reduce bucket-cost recomputation inside the remaining flush bottleneck, but its smoke result regressed wall clock to `471.991s` and `recent_lane_session_event_flush` to `440.356s`. Keep H.7 as a failed/unfinished experiment, not a reason to reject H.6.

## Evidence

### Commands Run

```bash
node --test test/sync-rebuild-profile.test.js test/sync-rebuild-vibedeck-db.test.js test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js
node scripts/smoke/rebuild-hot-path-phase-h6.cjs
npm --prefix dashboard ci
npm run dashboard:build
node /tmp/vibedeck_h6_premerge_deep_audit.cjs /Users/vasuyadav/Downloads/Projects/VibeDeck/.worktrees/phase-h6-repair-resolve-cache 7818 2026-05-01 2026-05-21 Asia/Kolkata
```

### Artifacts

- H.6 smoke summary: `docs/superpowers/plans/phase-h6-smoke-artifacts/phase-h6-rebuild-summary.json`
- H.6 smoke profile: `docs/superpowers/plans/phase-h6-smoke-artifacts/phase-h6-rebuild-profile.json`
- API/DB audit JSON: `docs/superpowers/plans/phase-h6-premerge-audit-artifacts/api-db-audit-2026-05-21.json`
- H.7 experimental summary, not part of this branch: `.worktrees/phase-h7-bucket-cost-batch-recompute/docs/superpowers/plans/phase-h7-smoke-artifacts/phase-h7-rebuild-summary.json`

## Findings

### Finding 1 - H.6 Rebuild Is Under 5 Minutes But Strict Summary Is No Longer Fully Green

**Severity:** Medium. **Confidence:** Confirmed.

Fresh pre-merge H.6 smoke succeeded at the command level (`exit_code=0`) and stayed under the wall-clock gate, but the summary result is `fail` due to a `390ms` branch-fact pass regression.

| Metric | H.5 baseline | Fresh H.6 pre-merge run | Gate |
|---|---:|---:|---|
| Wall clock | `285.133s` | `249.396s` | Pass |
| Target wall clock | n/a | `300.000s` | Pass by `50.604s` |
| `repair_pass` | `37.711s` | `1.015s` | Pass |
| `branch_fact_rebuild_pass` | `25.900s` | `26.291s` | Fail by `0.390s` |
| `recent_lane_session_event_flush` | n/a | `215.845s` | Dominant remaining stage |

**User-visible consequence:** H.6 makes the repair-attribution bottleneck real-fast, but the full rebuild is still about `4m 09s` on this machine and the remaining bottleneck is still the flush/write path.

**Smallest safe fix:** Do not expand H.6. Merge only if the release branch accepts a `4m 09s` rebuild and a documented minor branch-fact timing variance. Continue speed work in the flush path separately.

### Finding 2 - `/usage` Data Is Present For Codex When Queried With A Real Date Range

**Severity:** Low. **Confidence:** Confirmed.

The earlier zero `/usage` probe used empty `from`/`to`, which asks the endpoint for an empty date range. With `from=2026-05-01&to=2026-05-21&tz=Asia/Kolkata`, `/usage` returns May totals and Codex appears in the provider breakdown.

| Surface | Result |
|---|---:|
| `/functions/vibedeck-usage-summary` | 200 in `76ms` |
| `/functions/vibedeck-usage-daily` | 200 in `41ms`, `19` rows |
| `/functions/vibedeck-usage-monthly` | 200 in `43ms`, `1` May row |
| May total tokens | `5,176,459,586` |
| May total cost | `$3,286.915378` |
| Codex May bucket tokens | `4,204,597,474` |
| Claude May bucket tokens | `857,114,865` |
| Cursor May bucket tokens | `114,747,247` |

**User-visible consequence:** The monthly usage backend is populated and includes Codex. If the UI still appears empty, the remaining bug is likely UI state/loading/range wiring, not missing canonical backend data.

**Smallest safe fix:** Keep H.6 as backend-safe. Track the Usage tab loader/range UX as separate UI work.

### Finding 3 - `/dashboard` And `/branches` Are Serving Rich Data, Including Unknown Buckets

**Severity:** Low. **Confidence:** Confirmed.

`/dashboard` and `/branches` returned populated data. SQLite health is good and Unknown/Historical unknown remain preserved.

| Check | Result |
|---|---:|
| SQLite `PRAGMA quick_check` | `ok` |
| `/functions/vibedeck-project-usage-summary?limit=10` | 200 in `26ms` |
| `/functions/vibedeck-branch-usage?include_date_buckets=1&include_sessions=1&include_unattributed=1` | 200 in `16ms` |
| Branch response repo count | `263` |
| Branch response branch count | `282` |
| Unknown branch rows in DB | `1` row, `143,889,980` tokens, `$97.4731` |
| Historical unknown rows in DB | `58` rows, `867,703,265` tokens, `$380.4749` |
| VibeDeck `main` fact/session token match | exact token match: `1,487,998,879` |

Top VibeDeck branch rows remained rich, not placeholders:

| Branch | Tokens | Cost | Sessions | Last seen |
|---|---:|---:|---:|---|
| `main` | `1,487,998,879` | `$821.8369` | `159` | `2026-05-16T00:16:16.337Z` |
| `release/0.1.3` | `820,359,393` | `$597.4616` | `189` | `2026-05-20T20:10:56.942Z` |
| `entire/ui-fix` | `330,050,417` | `$249.2587` | `24` | `2026-05-19T12:08:49.216Z` |

**User-visible consequence:** H.6 does not wipe `/dashboard`, `/usage`, `/branches`, side-drawer source data, Unknown branch, or Historical unknown. The known Codex stale-branch limitation for long sessions still exists; H.6 does not claim to solve that.

**Smallest safe fix:** Keep the stale Codex long-session branch-window issue separate from H.6. It needs source evidence or head-history/windowing work, not repair-cache work.

### Finding 4 - Source Worktree Needs Dashboard Build Before Serve Works

**Severity:** Medium. **Confidence:** Confirmed.

The first source-worktree serve attempt failed because `dashboard/dist` did not exist. After installing dashboard dependencies and building the dashboard, repeated `serve --no-sync` readiness was fast.

| Step | Result |
|---|---|
| First source-worktree serve attempt | failed with `Dashboard not found`; instructed `cd dashboard && npm run build` |
| `npm --prefix dashboard ci` | passed; npm reported `9` vulnerabilities (`7` moderate, `2` high) |
| `npm run dashboard:build` | passed in `3m 42s`; Vite warned main chunk is `1,011.35 kB` |
| Repeated `serve --no-sync` after build | ready in `570ms` |

**User-visible consequence:** Published packages should include `dashboard/dist`, but fresh source worktrees need an explicit build before local serve smoke. The large dashboard chunk and npm audit warning are release-packaging concerns, not H.6 backend regressions.

**Smallest safe fix:** Keep this as a release checklist item: source worktree smoke requires `npm --prefix dashboard ci && npm run dashboard:build`; published package should verify `dashboard/dist` is included.

### Finding 5 - H.7 Is Worth Understanding But Not Worth Merging As Implemented

**Severity:** Medium. **Confidence:** Confirmed.

H.7 attempted to attack the right remaining area: repeated bucket-cost recomputation inside the flush/write path. The implementation did not produce the expected speedup.

| Metric | H.6 accepted baseline | H.7 experiment | Gate |
|---|---:|---:|---|
| Wall clock | `242.596s` | `471.991s` | Fail |
| Target wall clock | n/a | `300.000s` | Missed by `171.991s` |
| `recent_lane_session_event_flush` | `208.729s` | `440.356s` | Fail |
| `repair_pass` | `1.034s` | `0.976s` | Pass |
| `branch_fact_rebuild_pass` | `25.641s` | `24.631s` | Pass |

**User-visible consequence:** H.7 confirms the flush path is the right area to profile next, but the current code path makes the app slower. It should be kept as a failed experiment/investigation trail, not merged with H.6.

**Smallest safe fix:** Before reviving H.7, profile inside `recent_lane_session_event_flush` with per-substage timers and row-count counters. Do not add more batching blindly.

## Things Checked And Found Correct

- Test suite slice passed: `35` tests passed, `0` failed across rebuild profile, rebuild DB, parity harness, and parallel parse parity tests.
- H.6 rebuild command itself exited `0`; data promotion completed.
- Local API endpoints for sync status, usage summary, daily usage, monthly usage, model breakdown, dashboard projects, and branch usage all returned 200.
- Codex is present in May usage backend data with non-zero tokens.
- Unknown branch and Historical unknown remain explicit, populated categories.
- VibeDeck branch facts and session totals match exactly for the sampled `main` branch token count.

## Merge Readiness Verdict

H.6 is mergeable only with the audit note attached: it is a repair-pass speed fix that gets this machine's rebuild to about `4m 09s`, not a complete rebuild acceleration to `1-2m`. The data surfaces are intact in the audited run.

Do not merge H.7 into the release branch. Keep it as a non-accepted experiment until the flush-stage regression is understood and reversed.
