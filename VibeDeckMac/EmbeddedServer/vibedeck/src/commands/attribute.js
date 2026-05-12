const os = require("node:os");
const path = require("node:path");

const { DatabaseSync } = require("node:sqlite");
const { resolveTrackerPaths } = require("../lib/tracker-paths");
const { ensureSchema } = require("../lib/db");
const { upsertOverride, clearOverride } = require("../lib/sessions/overrides");

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

function parseArgs(argv = []) {
  const out = { provider: null, session: null, branch: null, clear: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--provider") out.provider = argv[++i] || null;
    else if (a === "--session") out.session = argv[++i] || null;
    else if (a === "--branch") out.branch = argv[++i] || null;
    else if (a === "--clear") out.clear = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  return out;
}

function sessionExists(dbPath, { provider, session_id } = {}) {
  const db = new DatabaseSync(dbPath);
  try {
    const row = db
      .prepare("SELECT provider, session_id FROM vibedeck_sessions WHERE provider = ? AND session_id = ?")
      .get(provider, session_id);
    return Boolean(row);
  } finally {
    db.close();
  }
}

async function cmdAttribute(argv = []) {
  const opts = parseArgs(argv);

  if (!isNonEmptyString(opts.provider)) throw new Error("attribute: --provider is required");
  if (!isNonEmptyString(opts.session)) throw new Error("attribute: --session is required");

  if (opts.clear && isNonEmptyString(opts.branch)) {
    throw new Error("attribute: --clear cannot be combined with --branch");
  }
  if (!opts.clear && !isNonEmptyString(opts.branch)) {
    throw new Error("attribute: provide --branch or use --clear");
  }

  const home = os.homedir();
  const { trackerDir } = await resolveTrackerPaths({ home });
  const dbPath = path.join(trackerDir, "vibedeck.sqlite3");
  ensureSchema(dbPath);

  const provider = opts.provider.trim();
  const session_id = opts.session.trim();

  if (!sessionExists(dbPath, { provider, session_id })) {
    process.stderr.write(`Session not found: provider=${provider} session_id=${session_id}\n`);
    process.exitCode = 1;
    return;
  }

  if (opts.clear) {
    clearOverride(dbPath, { provider, session_id });
    process.stdout.write("OK\n");
    return;
  }

  upsertOverride(dbPath, {
    provider,
    session_id,
    branch: opts.branch,
    set_by: "cli",
  });
  process.stdout.write("OK\n");
}

module.exports = { cmdAttribute };
