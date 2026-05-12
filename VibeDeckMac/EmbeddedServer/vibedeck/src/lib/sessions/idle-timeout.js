'use strict';

function getIdleTimeoutMin(idleTimeoutMin) {
  const raw = idleTimeoutMin != null ? idleTimeoutMin : process.env.VIBEDECK_IDLE_TIMEOUT_MIN;
  const parsed = parseInt(raw == null ? '30' : String(raw), 10);
  return Number.isFinite(parsed) ? parsed : 30;
}

module.exports = { getIdleTimeoutMin };
