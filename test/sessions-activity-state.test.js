const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  sessionActivityIso,
  isSessionEnded,
  isLiveEligibleSession,
  shouldReapIdleSession,
  liveSortIso,
} = require("../src/lib/sessions/activity-state");

test("sessionActivityIso prefers last_observed_at over updated_at", () => {
  const row = {
    started_at: "2026-04-01T00:00:00.000Z",
    last_observed_at: "2026-04-01T00:05:00.000Z",
    updated_at: "2026-05-12T00:00:00.000Z",
  };
  assert.equal(sessionActivityIso(row), "2026-04-01T00:05:00.000Z");
});

test("live eligibility rejects old open rows even if updated_at is fresh", () => {
  const row = {
    ended_at: null,
    state: "live",
    started_at: "2026-04-01T00:00:00.000Z",
    last_observed_at: "2026-04-01T00:05:00.000Z",
    updated_at: "2026-05-12T00:00:00.000Z",
  };
  assert.equal(isLiveEligibleSession(row, {
    now: "2026-05-12T00:00:00.000Z",
    idleTimeoutMin: 60,
  }), false);
  assert.equal(shouldReapIdleSession(row, {
    now: "2026-05-12T00:00:00.000Z",
    idleTimeoutMin: 60,
  }), true);
});

test("live eligibility keeps fresh open rows", () => {
  const row = {
    ended_at: null,
    state: "live",
    started_at: "2026-05-12T00:00:00.000Z",
    last_observed_at: "2026-05-12T00:15:00.000Z",
    updated_at: "2026-05-12T00:16:00.000Z",
  };
  assert.equal(isLiveEligibleSession(row, {
    now: "2026-05-12T00:30:00.000Z",
    idleTimeoutMin: 60,
  }), true);
});

test("ended sessions are never live eligible but still sort by observed activity", () => {
  const row = {
    ended_at: "2026-05-12T00:20:00.000Z",
    last_observed_at: "2026-05-12T00:19:00.000Z",
    updated_at: "2026-05-12T00:30:00.000Z",
  };
  assert.equal(isSessionEnded(row), true);
  assert.equal(isLiveEligibleSession(row, {
    now: "2026-05-12T00:30:00.000Z",
    idleTimeoutMin: 60,
  }), false);
  assert.equal(liveSortIso(row), "2026-05-12T00:19:00.000Z");
});
