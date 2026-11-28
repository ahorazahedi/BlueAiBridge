#!/usr/bin/env bash
# Put the bridge and a Node.js runtime inside a desktop app bundle, so installing
# the app is all a user has to do:
#   scripts/bundle-bridge.sh <dir> <linux-x64|linux-arm64|win-x64|darwin-arm64|darwin-x64>
# <dir> is the Flutter bundle (next to the executable) or BlueAIBridge.app/Contents/Resources.
# Writes <app-bundle-dir>/bridge/{dist,package.json,node/node[.exe]}. On first
# launch the app runs `bridge/node/node bridge/dist/src/cli.js install`.
# Needs the bridge built first (npm run build).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:?app bundle dir}"
PLATFORM="${2:?linux-x64|linux-arm64|win-x64|darwin-arm64|darwin-x64}"
NODE_VERSION="${NODE_VERSION:-22.18.0}"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/blueaibridge/node"

[ -f "$ROOT/dist/src/cli.js" ] && [ -f "$ROOT/dist/dashboard/index.html" ] || { echo "build the bridge first: npm run build" >&2; exit 1; }

case "$PLATFORM" in
  linux-x64 | linux-arm64) ARCHIVE="node-v$NODE_VERSION-$PLATFORM.tar.xz" EXE=node ;;
  darwin-arm64 | darwin-x64) ARCHIVE="node-v$NODE_VERSION-$PLATFORM.tar.gz" EXE=node ;;
  win-x64) ARCHIVE="node-v$NODE_VERSION-$PLATFORM.zip" EXE=node.exe ;;
  *) echo "unknown platform $PLATFORM" >&2; exit 1 ;;
esac

# Node.js, checked against the release's published SHA-256
mkdir -p "$CACHE"
BASE="https://nodejs.org/dist/v$NODE_VERSION"
if [ ! -f "$CACHE/$ARCHIVE" ]; then
  curl -fsSL "$BASE/$ARCHIVE" -o "$CACHE/$ARCHIVE.part"
  mv "$CACHE/$ARCHIVE.part" "$CACHE/$ARCHIVE"
fi
WANT=$(curl -fsSL "$BASE/SHASUMS256.txt" | awk -v f="$ARCHIVE" '$2 == f { print $1 }')
if command -v sha256sum >/dev/null; then GOT=$(sha256sum "$CACHE/$ARCHIVE"); else GOT=$(shasum -a 256 "$CACHE/$ARCHIVE"); fi
GOT=${GOT%% *}
[ -n "$WANT" ] && [ "$WANT" = "$GOT" ] || { rm -f "$CACHE/$ARCHIVE"; echo "checksum mismatch for $ARCHIVE" >&2; exit 1; }

OUT="$DEST/bridge"
rm -rf "$OUT"
mkdir -p "$OUT/node"
case "$ARCHIVE" in
  *.tar.xz) tar -xJf "$CACHE/$ARCHIVE" -C "$OUT/node" --strip-components=2 "node-v$NODE_VERSION-$PLATFORM/bin/node" ;;
  *.tar.gz) tar -xzf "$CACHE/$ARCHIVE" -C "$OUT/node" --strip-components=2 "node-v$NODE_VERSION-$PLATFORM/bin/node" ;;
  *.zip) unzip -p "$CACHE/$ARCHIVE" "node-v$NODE_VERSION-$PLATFORM/node.exe" > "$OUT/node/node.exe" ;;
esac
chmod 755 "$OUT/node/$EXE"

# the bridge itself: compiled code + dashboard, no tests or source maps (it has no runtime dependencies)
cp -r "$ROOT/dist" "$OUT/dist"
rm -rf "$OUT/dist/test"
find "$OUT/dist" -name '*.map' -delete
VERSION=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$ROOT/package.json")
printf '{\n  "name": "blue-ai-bridge-runtime",\n  "version": "%s",\n  "type": "module",\n  "private": true\n}\n' "$VERSION" > "$OUT/package.json"
echo "bundled bridge v$VERSION + Node.js v$NODE_VERSION ($PLATFORM) into $OUT"
