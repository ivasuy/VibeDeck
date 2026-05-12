'use strict';

const { runEntireLogin } = require("../lib/bootstrap/ensure-entire");

async function run(argv = []) {
  const [subcommand] = argv;
  if (subcommand !== "login") {
    process.stderr.write("Usage: vibedeck entire login\n");
    return 1;
  }
  try {
    await runEntireLogin();
    process.stdout.write("Entire login complete.\n");
    return 0;
  } catch (err) {
    const msg = err && (err.shortMessage || err.message) ? err.shortMessage || err.message : "unknown error";
    process.stderr.write(`Entire login failed: ${msg}\n`);
    return 1;
  }
}

module.exports = { run };
