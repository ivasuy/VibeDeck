const assert = require("node:assert/strict");
const test = require("node:test");

const { run } = require("../src/cli");

test("no-arg vibedeck checks prerequisites before serving", async () => {
  const cliPath = require.resolve("../src/cli");
  const servePath = require.resolve("../src/commands/serve");
  const orchestratorPath = require.resolve("../src/lib/bootstrap/orchestrator");
  const serveOriginal = require.cache[servePath];
  const orchestratorOriginal = require.cache[orchestratorPath];
  let called = [];
  try {
    require.cache[servePath] = {
      id: servePath,
      filename: servePath,
      loaded: true,
      exports: {
        cmdServe: async () => {
          called.push("serve");
        },
      },
    };
    require.cache[orchestratorPath] = {
      id: orchestratorPath,
      filename: orchestratorPath,
      loaded: true,
      exports: {
        runFirstRunBootstrapIfNeeded: async () => {
          called.push("bootstrap");
        },
      },
    };

    delete require.cache[cliPath];
    const cli = require("../src/cli");
    await cli.run([]);
  } finally {
    if (serveOriginal) require.cache[servePath] = serveOriginal;
    else delete require.cache[servePath];

    if (orchestratorOriginal) {
      require.cache[orchestratorPath] = orchestratorOriginal;
    } else {
      delete require.cache[orchestratorPath];
    }
    delete require.cache[cliPath];
  }

  assert.deepEqual(called, ["bootstrap", "serve"]);
});
