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
    colors.includes("static var chromeTop: Color {"),
    "chromeTop should be appearance-aware so dark mode can use a darker surface"
  );
  assert.ok(
    colors.includes("static var chromeBottom: Color {"),
    "chromeBottom should be appearance-aware so dark mode can use a darker surface"
  );
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

test("widget metadata and strings should stay searchable under the VibeDeck name", () => {
  const widgetStrings = read("VibeDeckMac/VibeDeckWidget/Views/WidgetStrings.swift");
  const widgetInfo = read("VibeDeckMac/VibeDeckWidget/Info.plist");

  assert.ok(
    widgetStrings.includes('static var usageName: String { "VibeDeck Usage" }'),
    "usage widget should be searchable with the VibeDeck name"
  );
  assert.ok(
    widgetStrings.includes('static var heatmapName: String { "VibeDeck Heatmap" }'),
    "heatmap widget should be searchable with the VibeDeck name"
  );
  assert.ok(
    widgetInfo.includes("<string>VibeDeck Widgets</string>"),
    "widget extension display name should remain branded as VibeDeck"
  );
});

test("widget theme should adapt surfaces for dark mode", () => {
  const widgetTheme = read("VibeDeckMac/VibeDeckWidget/Views/WidgetTheme.swift");

  assert.ok(
    widgetTheme.includes("ColorScheme"),
    "widget theme should branch on SwiftUI color scheme"
  );
  assert.ok(
    widgetTheme.includes("surfaceTop(for colorScheme: ColorScheme)"),
    "widget theme should expose a color-scheme-aware top surface"
  );
  assert.ok(
    widgetTheme.includes("surfaceBottom(for colorScheme: ColorScheme)"),
    "widget theme should expose a color-scheme-aware bottom surface"
  );
  assert.ok(
    widgetTheme.includes("@Environment(\\.colorScheme)"),
    "widget background should read the environment color scheme"
  );
});

test("top models view should use provider logos instead of rank dots", () => {
  const topModelsView = read("VibeDeckMac/VibeDeckMac/Views/TopModelsView.swift");

  assert.ok(
    topModelsView.includes("BrandLogoResolver.shared.image"),
    "top models rows should resolve provider logos from bundled assets"
  );
  assert.ok(
    topModelsView.includes("providerIcon"),
    "top models rows should render a dedicated provider icon view"
  );
  assert.ok(
    !topModelsView.includes(".fill(Color.modelDot"),
    "top models rows should no longer render rank dots as the primary provider marker"
  );
});

test("embedded mac bundle should use vibedeck.js as the only CLI entrypoint", () => {
  const bundleScript = read("VibeDeckMac/scripts/bundle-node.sh");
  const serverManager = read("VibeDeckMac/VibeDeckMac/Services/ServerManager.swift");

  assert.ok(
    bundleScript.includes('cp "$REPO_ROOT/bin/vibedeck.js" "$TT_DIR/bin/"'),
    "bundle script should copy bin/vibedeck.js into the embedded bundle"
  );
  assert.ok(
    !bundleScript.includes('cp "$REPO_ROOT/bin/tracker.js" "$TT_DIR/bin/"'),
    "bundle script should no longer copy tracker.js"
  );
  assert.ok(
    serverManager.includes('.appendingPathComponent("EmbeddedServer/vibedeck/bin/vibedeck.js")'),
    "native app should launch the embedded vibedeck.js entrypoint"
  );
  assert.ok(
    !serverManager.includes('EmbeddedServer/vibedeck/bin/tracker.js'),
    "native app should no longer reference tracker.js"
  );
});

test("icon patch script should reference the real AppIcon.icon path without hardcoded Xcode object ids", () => {
  const patchScript = read("VibeDeckMac/scripts/patch-pbxproj-icon.rb");
  const localBuildScript = read("scripts/build-release-mac.sh");

  assert.ok(
    patchScript.includes("ICON_RELATIVE_PATH = 'VibeDeckMac/AppIcon.icon'"),
    "icon patch should point at the repository-relative AppIcon.icon path used by CI"
  );
  assert.ok(
    patchScript.includes("sourceTree = SOURCE_ROOT"),
    "icon patch should anchor AppIcon.icon from SOURCE_ROOT so group attachment does not affect file resolution"
  );
  assert.ok(
    !patchScript.includes("6E651075DB834A2DD6917AAD"),
    "icon patch should not rely on generated Xcode object ids"
  );
  assert.ok(
    localBuildScript.includes('ruby "$REPO_ROOT/VibeDeckMac/scripts/patch-pbxproj-icon.rb"'),
    "local native release script should run the same icon patch as CI"
  );
});

test("native app product name should ship as VibeDeck", () => {
  const projectYml = read("VibeDeckMac/project.yml");
  const dmgScript = read("VibeDeckMac/scripts/create-dmg.sh");

  assert.ok(
    projectYml.includes('PRODUCT_NAME: VibeDeck'),
    "native app PRODUCT_NAME should be VibeDeck"
  );
  assert.ok(
    projectYml.includes('CFBundleName: VibeDeck'),
    "native app bundle name should be VibeDeck"
  );
  assert.ok(
    dmgScript.includes('APP_NAME="VibeDeck"'),
    "DMG packaging should stage VibeDeck.app"
  );
  assert.ok(
    dmgScript.includes('VOLUME_NAME="VibeDeck"'),
    "DMG volume name should be VibeDeck"
  );
});
