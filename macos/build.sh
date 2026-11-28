#!/usr/bin/env bash
# Build the native BlueAIBridge app (window + menu-bar icon) into
# macos/build/BlueAIBridge.app, with the bridge and Node.js inside
# (Contents/Resources/bridge). Needs Xcode's Swift toolchain; macOS 14+.
set -euo pipefail
cd "$(dirname "$0")"
APP=build/BlueAIBridge.app
ARCH="$(uname -m)"
VERSION=$(node -p "require('../package.json').version")
rm -rf "$APP" build/icon.iconset
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "› compiling ($ARCH)…"
swiftc -O -parse-as-library -target "$ARCH-apple-macos14.0" \
  -o "$APP/Contents/MacOS/BlueAIBridge" Sources/*.swift \
  -framework SwiftUI -framework AppKit -framework Charts

echo "› icon…"
swiftc -O -o build/make-icon tools/make-icon.swift -framework AppKit
./build/make-icon build/icon.iconset
iconutil -c icns build/icon.iconset -o "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>BlueAIBridge</string>
  <key>CFBundleDisplayName</key><string>BlueAIBridge</string>
  <key>CFBundleIdentifier</key><string>com.blueaibridge.app</string>
  <key>CFBundleExecutable</key><string>BlueAIBridge</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>BlueAIBridge</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST
# the bridge and its own Node.js ship inside the app; it installs them on first launch
[ -f ../dist/src/cli.js ] || (cd .. && npm ci && npm run build)
case "$ARCH" in arm64) NODE_ARCH=arm64 ;; *) NODE_ARCH=x64 ;; esac
../scripts/bundle-bridge.sh "$APP/Contents/Resources" "darwin-$NODE_ARCH"

# sign the app (ad hoc); the bundled node keeps the signature nodejs.org gave it
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
echo "built $(pwd)/$APP"
