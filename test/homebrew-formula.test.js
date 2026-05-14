const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const FORMULA_PATH = path.join(
  __dirname,
  "..",
  "packaging",
  "homebrew",
  "vibedeck.rb"
);

test("homebrew formula installs via npm and exposes a CLI test", () => {
  const formula = fs.readFileSync(FORMULA_PATH, "utf8");
  assert.ok(formula.includes('system "npm", "install"'));
  assert.match(formula, /bin\.install_symlink libexec\/"bin\/vibedeck"/);
  assert.match(formula, /test do/);
  assert.match(formula, /shell_output\("\#\{bin\}\/vibedeck --help"\)/);
});

test("homebrew formula contains install step", () => {
  const formula = fs.readFileSync(FORMULA_PATH, "utf8");
  assert.match(formula, /def install/);
  assert.match(formula, /depends_on "node"/);
  assert.match(formula, /system "npm", "install"/);
});
