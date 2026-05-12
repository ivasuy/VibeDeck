const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function read(filePath) {
  return fs.readFileSync(path.join(ROOT, filePath), "utf8");
}

test("post-build resources script copies brand logos independently of EmbeddedServer", () => {
  const projectYml = read("VibeDeckMac/project.yml");

  assert.ok(
    projectYml.includes("Copy EmbeddedServer to app bundle"),
    "postBuildScripts must include the resources copy phase name"
  );
  assert.ok(
    projectYml.includes("DST_DIR=\"${BUILT_PRODUCTS_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/EmbeddedServer\""),
    "legacy EmbeddedServer destination should remain"
  );
  assert.ok(
    projectYml.includes("DASHBOARD_BRAND_LOGOS_DIR=\"${SRCROOT}/../dashboard/dist/brand-logos\""),
    "dashboard brand-logos source should be wired into script"
  );
  assert.ok(projectYml.includes("if [ ! -d \"$SRC_DIR\" ]"));
  assert.ok(projectYml.includes("if [ ! -d \"$DASHBOARD_BRAND_LOGOS_DIR\" ]"));
  assert.ok(
    projectYml.includes("BRAND_LOGOS_DIR=\"${BUILT_PRODUCTS_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/brand-logos\""),
    "brand logos should be copied into Resources"
  );
  assert.ok(
    projectYml.includes("if [ -d \"$DASHBOARD_BRAND_LOGOS_DIR\" ]"),
    "brand-logo copy should only run when source exists"
  );
});

test("provider logo resolution uses shared helper instead of duplicated EmbeddedServer path strings", () => {
  const limitsSettings = read("VibeDeckMac/VibeDeckMac/Views/LimitsSettingsView.swift");
  const usageLimits = read("VibeDeckMac/VibeDeckMac/Views/UsageLimitsView.swift");
  const helper = read("VibeDeckMac/VibeDeckMac/Utilities/BrandLogoResolver.swift");

  assert.ok(helper.includes("struct BrandLogoResolver"), "shared helper file should exist");
  assert.ok(!limitsSettings.includes("EmbeddedServer/vibedeck/dashboard/dist/brand-logos"));
  assert.ok(!usageLimits.includes("EmbeddedServer/vibedeck/dashboard/dist/brand-logos"));
  assert.ok(limitsSettings.includes("BrandLogoResolver.shared.image"));
  assert.ok(usageLimits.includes("BrandLogoResolver.shared.image"));
});

test("widget extension remains embedded in native build configuration", () => {
  const pbxproj = read("VibeDeckMac/VibeDeckMac.xcodeproj/project.pbxproj");

  assert.ok(pbxproj.includes("VibeDeckWidget.appex"), "widget target should remain referenced");
  assert.ok(pbxproj.includes("VibeDeckWidget.appex in Embed Foundation Extensions"));
  assert.ok(pbxproj.includes("name = \"Copy EmbeddedServer to app bundle\""));
});

test("theme tokens should remain appearance-aware and preserve VibeDeck indigo styling", () => {
  const colors = read("VibeDeckMac/VibeDeckMac/Utilities/Colors.swift");

  assert.ok(
    colors.includes("static var panelFill: Color {"),
    "panelFill should be an appearance-aware computed color"
  );
  assert.ok(
    colors.includes("static var panelFillStrong: Color {"),
    "panelFillStrong should be an appearance-aware computed color"
  );
  assert.ok(
    colors.includes("NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua])"),
    "theme tokens should branch for dark and light appearance"
  );
  assert.ok(
    colors.includes("0.306") && colors.includes("0.322") && colors.includes("0.612"),
    "indigo-brand channel values should be preserved for panel colors"
  );
  assert.ok(!colors.includes("controlAccentColor"), "theme tokens should not switch to global accent color");
});
