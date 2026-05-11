const { cmdInit } = require("./commands/init");
const { cmdSync } = require("./commands/sync");
const { cmdStatus } = require("./commands/status");
const { cmdDiagnostics } = require("./commands/diagnostics");
const { cmdDoctor } = require("./commands/doctor");
const { cmdUninstall } = require("./commands/uninstall");
const { cmdServe } = require("./commands/serve");
const { cmdAttribute } = require("./commands/attribute");

async function run(argv) {
  const [command, ...rest] = argv;

  // No args → launch dashboard
  if (!command) {
    await cmdServe(argv);
    return;
  }

  if (command === "-h" || command === "--help") {
    printHelp();
    return;
  }

  switch (command) {
    case "serve":
      await cmdServe(rest);
      return;
    case "init":
      await cmdInit(rest);
      return;
    case "sync":
      await cmdSync(rest);
      return;
    case "status":
      await cmdStatus(rest);
      return;
    case "diagnostics":
      await cmdDiagnostics(rest);
      return;
    case "doctor":
      await cmdDoctor(rest);
      return;
    case "uninstall":
      await cmdUninstall(rest);
      return;
    case "attribute":
      await cmdAttribute(rest);
      return;
    case "auth":
      process.exitCode = await require("./commands/auth").run(rest);
      return;
    case "repo":
      process.exitCode = await require("./commands/repo").run(rest);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function printHelp() {
  // Keep this short; npx users want quick guidance.
  process.stdout.write(
    [
      "vibedeck",
      "",
      "Usage:",
      "  npx vibedeck-cli                                         Open local dashboard",
      "  npx vibedeck-cli [--debug] serve [--port 7690] [--no-open] [--no-sync]",
      "  npx vibedeck-cli [--debug] init [--yes] [--dry-run] [--no-open] [--link-code <code>]",
      "  npx vibedeck-cli [--debug] sync [--auto] [--drain] [--from-openclaw]",
      "  npx vibedeck-cli [--debug] status [--probe-keychain] [--probe-keychain-details]",
      "  npx vibedeck-cli [--debug] diagnostics [--out diagnostics.json]",
      "  npx vibedeck-cli [--debug] doctor [--json] [--out doctor.json] [--base-url <url>]",
      "  npx vibedeck-cli [--debug] uninstall [--purge]",
      "",
      "Notes:",
      "  - init: consent first, then local hook setup.",
      "  - --yes skips the consent menu (non-interactive safe).",
      "  - --dry-run previews changes without writing files.",
      "  - optional: --link-code <code> is reserved for native app flows.",
      "  - Every Code notify installs when ~/.code/config.toml exists.",
      "  - OpenClaw hook auto-links when OpenClaw is installed (requires gateway restart).",
      "  - sync parses local provider logs and refreshes the local VibeDeck database.",
      "  - --from-openclaw marks sync runs triggered by OpenClaw hooks.",
      "  - --debug shows original backend errors.",
      "",
    ].join("\n"),
  );
}

module.exports = { run };
