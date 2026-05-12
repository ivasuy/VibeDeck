'use strict';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function validIso(value) {
  if (!isNonEmptyString(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? value : null;
}

function isoMs(value) {
  const iso = validIso(value);
  if (!iso) return null;
  const time = Date.parse(iso);
  return Number.isFinite(time) ? time : null;
}

function sessionActivityIso(row) {
  return (
    validIso(row?.last_observed_at) ||
    validIso(row?.observed_at) ||
    validIso(row?.ended_at) ||
    validIso(row?.started_at) ||
    validIso(row?.created_at) ||
    null
  );
}

function liveSortIso(row) {
  return sessionActivityIso(row) || validIso(row?.updated_at) || '';
}

function isSessionEnded(row) {
  if (!row) return false;
  if (isNonEmptyString(row.ended_at)) return true;
  return String(row.state || '').trim().toLowerCase() === 'ended';
}

function isLiveEligibleSession(row, { now = new Date(), idleTimeoutMin } = {}) {
  if (!row || isSessionEnded(row)) return false;
  const timeout = Number(idleTimeoutMin);
  if (!Number.isFinite(timeout) || timeout <= 0) return true;
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const activityMs = isoMs(sessionActivityIso(row));
  if (!Number.isFinite(nowMs) || !Number.isFinite(activityMs)) return false;
  return nowMs - activityMs <= timeout * 60 * 1000;
}

function shouldReapIdleSession(row, { now = new Date(), idleTimeoutMin } = {}) {
  if (!row || isSessionEnded(row)) return false;
  const timeout = Number(idleTimeoutMin);
  if (!Number.isFinite(timeout) || timeout <= 0) return false;
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const activityMs = isoMs(sessionActivityIso(row));
  if (!Number.isFinite(nowMs) || !Number.isFinite(activityMs)) return false;
  return nowMs - activityMs > timeout * 60 * 1000;
}

module.exports = {
  sessionActivityIso,
  liveSortIso,
  isSessionEnded,
  isLiveEligibleSession,
  shouldReapIdleSession,
};
