#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# build-release-mac.sh — Build VibeDeck.app and package VibeDeck.dmg in one step
# Usage: ./scripts/build-release-mac.sh [--skip-dashboard] [--skip-dmg] [--no-adhoc-sign]
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$REPO_ROOT/VibeDeckMac"
DERIVED_DATA_PATH="$PROJECT_DIR/build/DerivedData"
CONFIGURATION="Release"
APP_NAME="VibeDeck"
APP_PATH="$DERIVED_DATA_PATH/Build/Products/$CONFIGURATION/${APP_NAME}.app"
DMG_PATH="$PROJECT_DIR/build/${APP_NAME}.dmg"

BUILD_DASHBOARD=true
BUILD_DMG=true
ADHOC_SIGN=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-dashboard)
      BUILD_DASHBOARD=false
      shift
      ;;
    --skip-dmg)
      BUILD_DMG=false
      shift
      ;;
    --no-adhoc-sign)
      ADHOC_SIGN=false
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 [--skip-dashboard] [--skip-dmg] [--no-adhoc-sign]" >&2
      exit 1
      ;;
  esac
done

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "Error: xcodegen is required. Install it with: brew install xcodegen" >&2
  exit 1
fi

echo "==> Building native release for $APP_NAME"

if $BUILD_DASHBOARD; then
  echo "==> Building dashboard assets..."
  npm --prefix "$REPO_ROOT/dashboard" run build
else
  echo "==> Skipping dashboard build"
fi

echo "==> Bundling embedded server..."
bash "$REPO_ROOT/VibeDeckMac/scripts/bundle-node.sh"

echo "==> Generating Xcode project..."
xcodegen generate --spec "$REPO_ROOT/VibeDeckMac/project.yml"

echo "==> Building $APP_NAME.app..."
xcodebuild \
  -project "$PROJECT_DIR/VibeDeckMac.xcodeproj" \
  -scheme VibeDeckMac \
  -configuration "$CONFIGURATION" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  ARCHS="arm64 x86_64" \
  ONLY_ACTIVE_ARCH=NO \
  CODE_SIGN_IDENTITY="-" \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGNING_ALLOWED=NO \
  clean build

if [[ ! -d "$APP_PATH" ]]; then
  echo "Error: built app not found at $APP_PATH" >&2
  exit 1
fi

if $ADHOC_SIGN; then
  echo "==> Applying ad-hoc signing..."
  APPEX_PATH="$APP_PATH/Contents/PlugIns/VibeDeckWidget.appex"
  EMBEDDED_SERVER_PATH="$APP_PATH/Contents/Resources/EmbeddedServer"

  if [[ -d "$EMBEDDED_SERVER_PATH" ]]; then
    find "$EMBEDDED_SERVER_PATH" -type f \
      \( -name 'node' -o -name '*.dylib' -o -name '*.so' -o -name '*.node' \) \
      -exec codesign --force --timestamp=none --sign - {} \;
  fi

  if [[ -d "$APPEX_PATH" ]]; then
    codesign --force --timestamp=none \
      --entitlements "$PROJECT_DIR/VibeDeckWidget/VibeDeckWidget.entitlements" \
      --sign - "$APPEX_PATH"
  fi

  codesign --force --timestamp=none \
    --entitlements "$PROJECT_DIR/VibeDeckMac/VibeDeckMac.entitlements" \
    --sign - "$APP_PATH"

  codesign --verify --verbose=2 "$APP_PATH"

  if [[ -d "$APPEX_PATH" ]]; then
    echo "==> Verifying widget extension entitlements..."
    APPEX_ENTS_FILE="$(mktemp)"
    trap 'rm -f "$APPEX_ENTS_FILE"' EXIT
    codesign -d --entitlements - "$APPEX_PATH" 2>&1 | tee "$APPEX_ENTS_FILE"
    if ! grep -q "com.apple.security.app-sandbox" "$APPEX_ENTS_FILE"; then
      echo "Error: widget extension is missing com.apple.security.app-sandbox after signing." >&2
      echo "pkd will refuse to load it and the widget gallery will not list VibeDeck." >&2
      exit 1
    fi
  fi
else
  echo "==> Skipping ad-hoc signing"
fi

if $BUILD_DMG; then
  echo "==> Packaging DMG..."
  bash "$REPO_ROOT/VibeDeckMac/scripts/create-dmg.sh" "$APP_PATH"
else
  echo "==> Skipping DMG packaging"
fi

echo ""
echo "================================================"
echo "  App: $APP_PATH"
if $BUILD_DMG; then
  echo "  DMG: $DMG_PATH"
fi
echo "================================================"
