const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function read(repoPath) {
  return fs.readFileSync(path.join(ROOT, repoPath), "utf8");
}

test("native strings are English-only", () => {
  const strings = read("VibeDeckMac/VibeDeckMac/Utilities/Strings.swift");
  const widgetStrings = read("VibeDeckMac/VibeDeckWidget/Views/WidgetStrings.swift");
  assert.doesNotMatch(strings, /NativeLocalization\.usesChinese|static var zh|t\("[^"]+",\s*"[^"]+"\)/);
  assert.doesNotMatch(widgetStrings, /NativeLocalization\.usesChinese|static var zh|t\("[^"]+",\s*"[^"]+"\)/);
});

test("native update flags stay unchanged during cleanup", () => {
  const app = read("VibeDeckMac/VibeDeckMac/TokenTrackerBarApp.swift");
  const plist = read("VibeDeckMac/VibeDeckMac/Info.plist");
  const project = read("VibeDeckMac/project.yml");
  assert.doesNotMatch(app, /TokenTrackerEnableSilentAutoUpdate|isSilentAutoUpdateEnabled/);
  assert.doesNotMatch(plist, /TokenTrackerEnableSilentAutoUpdate/);
  assert.doesNotMatch(project, /TokenTrackerEnableSilentAutoUpdate/);
});
