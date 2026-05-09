'use strict';

const { EventEmitter } = require('node:events');

let singleton = null;

function getLiveBus() {
  if (singleton) return singleton;
  singleton = new EventEmitter();
  // This bus is process-local. In tests, we may enqueue >1000 events quickly.
  // Avoid EventEmitter leak warnings when many clients attach handlers.
  singleton.setMaxListeners(0);
  return singleton;
}

module.exports = { getLiveBus };

