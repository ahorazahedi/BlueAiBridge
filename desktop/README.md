# BlueAIBridge desktop app (Windows, Linux)

The Flutter version of the BlueAIBridge UI. It looks like the macOS (SwiftUI) app and talks to the same local broker API.

- **Pages:** Overview, Conversations, Traffic, Activity, Chat Library, Clients & Install, Health, Settings.
- **Window:** frameless; the sidebar runs up into the title bar. Window buttons follow the OS: flat on Windows, round on GNOME.
- **Tray icon:** live status, quick actions, Quit. Closing the window keeps the app in the tray. Started with `--background`, only the tray icon starts (used at login).
- **Shortcuts:** Ctrl+1…8 switch pages, Ctrl+R reloads (⌘ on macOS).
- Follows the system light/dark appearance and updates live from the broker's event stream.

## Run it (any OS, including your Mac)

```bash
cd desktop
flutter pub get
flutter run -d macos     # or: -d linux, -d windows
```

It connects to the broker on `127.0.0.1` using the token in `~/.blueaibridge/data`. Release builds carry the bridge and a Node.js runtime in `bridge/` next to the executable (`scripts/bundle-bridge.sh`) and, on first launch or when the app is newer than the installed runtime, run `bridge/node/node bridge/dist/src/cli.js install`. When run from source (`flutter run`) there is no `bridge/`: install BlueAIBridge first (`node dist/src/cli.js install` in the repo root).

## Build installers

| Target | How | Output (`desktop/build/dist/`) |
|---|---|---|
| Ubuntu / Debian (on a Mac) | `npm run build:linux` (Docker) | `blueaibridge_<v>_<arch>.deb`, `BlueAIBridge-<v>-linux-<arch>.tar.gz` |
| Ubuntu (natively) | `desktop/packaging/linux/build.sh` | same |
| Windows | GitHub Actions (`.github/workflows/build.yml`), or `npm run build`, `flutter build windows --release`, `bash scripts/bundle-bridge.sh build/windows/x64/runner/Release win-x64` + Inno Setup on Windows | `BlueAIBridge-<v>-windows-x64-setup.exe`, `.zip` |

Every build bundles the bridge and Node.js (downloaded from nodejs.org and checked against its SHA-256; `NODE_VERSION` picks the version). The Linux packages are built on Ubuntu 22.04 so they run there and on anything newer.

On a Mac, Docker builds for your Mac's own architecture (arm64 on Apple silicon). The x86_64 builds come from CI. Pushing a `v*` tag publishes all of them as a GitHub release.

Runtime needs on Linux: `libgtk-3-0` and `libayatana-appindicator3-1` (for the tray). On GNOME, the tray icon also needs the AppIndicator extension, which Ubuntu ships enabled.

## Tests

```bash
flutter analyze
flutter test
```
