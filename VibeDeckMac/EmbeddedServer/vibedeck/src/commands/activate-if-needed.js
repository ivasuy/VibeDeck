const { checkAndActivate } = require("../lib/activation-check");

/**
 * Detect and activate AI CLI integrations that are not configured yet.
 * Called by hooks and other trigger points.
 */
async function cmdActivateIfNeeded(argv) {
  const opts = parseArgs(argv);
  
  const results = await checkAndActivate({
    silent: opts.silent,
    autoConfigure: true,
  });
  
  if (!opts.silent) {
    if (results.length === 0) {
      console.log("All AI CLI integrations are configured");
    } else {
      for (const r of results) {
        console.log(`${r.displayName}: ${r.action}`);
      }
    }
  }
  
  const hasSuccess = results.some(r => r.action === "configured");
  process.exitCode = hasSuccess ? 0 : 0;
}

function parseArgs(argv) {
  const out = {
    silent: false,
  };
  for (const a of argv) {
    if (a === "--silent") out.silent = true;
  }
  return out;
}

module.exports = { cmdActivateIfNeeded };
