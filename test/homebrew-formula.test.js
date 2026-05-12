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

test("homebrew formula invokes VibeDeck bootstrap flow", () => {
  const formula = fs.readFileSync(FORMULA_PATH, "utf8");
  assert.match(formula, /bin\/"?vibedeck"?/);
  assert.match(formula, /bootstrap/);
  assert.ok(formula.includes('system "npm", "install"'));
});

test("homebrew formula contains install step", () => {
  const formula = fs.readFileSync(FORMULA_PATH, "utf8");
  assert.match(formula, /def install/);
  assert.match(formula, /node/);
  assert.match(formula, /system/);
});
