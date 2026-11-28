#!/usr/bin/env bash
# Inside the build container (or on an Ubuntu machine): build the bridge and the app, and
# package them together (the app carries the bridge and Node.js in bridge/).
#   desktop/packaging/linux/build.sh [out-dir]
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${1:-build/dist}"
VERSION=$(node -p "require('../package.json').version" 2>/dev/null || grep '^version:' pubspec.yaml | sed 's/version: //; s/+.*//')
# the bridge ships inside the app (with its own Node.js), so build it first
[ -f ../dist/src/cli.js ] || (cd .. && npm ci && npm run build)
flutter pub get
flutter build linux --release
ARCH_DIR=$(ls -d build/linux/*/release/bundle | head -1)
case "$ARCH_DIR" in *arm64*) DEB_ARCH=arm64 NODE_ARCH=arm64 ;; *) DEB_ARCH=amd64 NODE_ARCH=x64 ;; esac
../scripts/bundle-bridge.sh "$ARCH_DIR" "linux-$NODE_ARCH"
mkdir -p "$OUT"
# portable tarball
tar -C "$(dirname "$ARCH_DIR")" -czf "$OUT/BlueAIBridge-$VERSION-linux-$DEB_ARCH.tar.gz" --transform "s/^bundle/BlueAIBridge/" bundle
# .deb
# The binary needs at least the GLib it was built against; say so, so apt refuses
# an older system instead of the app failing at launch with an undefined symbol.
GLIB_MIN=$(pkg-config --modversion glib-2.0 | cut -d. -f1,2)
PKG=$(mktemp -d)
mkdir -p "$PKG/DEBIAN" "$PKG/opt/blueaibridge" "$PKG/usr/bin" "$PKG/usr/share/applications" "$PKG/usr/share/icons/hicolor/256x256/apps"
cp -r "$ARCH_DIR"/. "$PKG/opt/blueaibridge/"
ln -s /opt/blueaibridge/blue_ai_bridge "$PKG/usr/bin/blueaibridge"
cp assets/app_icon.png "$PKG/usr/share/icons/hicolor/256x256/apps/blueaibridge.png"
# named after the GTK application id (linux/CMakeLists.txt), so the dock and taskbar match the
# window to this entry and show its icon instead of a generic one
cat > "$PKG/usr/share/applications/com.blueaibridge.blue_ai_bridge.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=BlueAIBridge
Comment=Claude Code and ChatGPT review and talk to each other
Exec=/opt/blueaibridge/blue_ai_bridge
Icon=blueaibridge
Categories=Development;
StartupWMClass=com.blueaibridge.blue_ai_bridge
Terminal=false
DESKTOP
cat > "$PKG/DEBIAN/control" <<CONTROL
Package: blueaibridge
Version: $VERSION
Section: devel
Priority: optional
Architecture: $DEB_ARCH
Depends: libglib2.0-0 (>= $GLIB_MIN), libgtk-3-0, libayatana-appindicator3-1
Maintainer: BlueAIBridge
Description: BlueAIBridge desktop app
 Monitor and manage the bridge between Claude Code and ChatGPT/Codex:
 conversations, traffic, live activity, health and installation.
CONTROL
dpkg-deb --root-owner-group --build "$PKG" "$OUT/blueaibridge_${VERSION}_${DEB_ARCH}.deb"
rm -rf "$PKG"
ls -la "$OUT"
