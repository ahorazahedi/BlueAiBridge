// ignore_for_file: deprecated_member_use
// BlueAIBridge desktop app (Windows, Linux; also runs on macOS for testing).
// A frameless window with the full monitoring and management UI, and a tray
// icon that stays when the window is closed. `--background` starts with only
// the tray icon (used at login).

import 'dart:async';
import 'dart:io';

import 'package:material_ui/material_ui.dart';
import 'package:provider/provider.dart';
import 'package:tray_manager/legacy.dart';
import 'package:window_manager/legacy.dart';

import 'src/screenshots.dart';
import 'src/shell.dart';
import 'src/state/app_state.dart';
import 'src/theme/tokens.dart';

Future<void> main(List<String> args) async {
  WidgetsFlutterBinding.ensureInitialized();
  await windowManager.ensureInitialized();
  final background = args.contains('--background');
  final state = AppState();

  await windowManager.waitUntilReadyToShow(
    const WindowOptions(
      size: Size(1360, 880),
      minimumSize: Size(1000, 640),
      center: true,
      title: 'BlueAIBridge',
      titleBarStyle: TitleBarStyle.hidden,
      backgroundColor: Colors.transparent,
    ),
    () async {
      if (!background) {
        await windowManager.show();
        await windowManager.focus();
      }
    },
  );
  // closing the window keeps the app in the tray
  await windowManager.setPreventClose(true);

  runApp(ChangeNotifierProvider.value(value: state, child: const BlueAIBridgeApp()));
  state.start();
  await AppTray.instance.init(state);
  final shots = Platform.environment['BLUE_AI_BRIDGE_SCREENSHOTS'];
  if (shots != null && shots.isNotEmpty) unawaited(runScreenshots(state, shots));
}

class BlueAIBridgeApp extends StatefulWidget {
  const BlueAIBridgeApp({super.key});
  @override
  State<BlueAIBridgeApp> createState() => _BlueAIBridgeAppState();
}

class _BlueAIBridgeAppState extends State<BlueAIBridgeApp> with WindowListener {
  @override
  void initState() {
    super.initState();
    windowManager.addListener(this);
  }

  @override
  void dispose() {
    windowManager.removeListener(this);
    super.dispose();
  }

  @override
  void onWindowClose() async {
    if (AppTray.instance.available) {
      await windowManager.hide();
    } else {
      await windowManager.destroy();
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'BlueAIBridge',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(Brightness.light),
      darkTheme: buildTheme(Brightness.dark),
      themeMode: ThemeMode.system,
      home: RepaintBoundary(key: screenshotKey, child: const Shell()),
    );
  }
}

/// The tray icon (Windows notification area, Linux top bar, macOS menu bar):
/// live status and quick actions.
class AppTray with TrayListener {
  AppTray._();
  static final AppTray instance = AppTray._();
  bool available = false;
  late AppState _state;
  String _lastMenu = '';

  Future<void> init(AppState state) async {
    _state = state;
    try {
      await trayManager.setIcon(Platform.isWindows ? 'assets/tray/tray.ico' : 'assets/tray/tray.png', isTemplate: false);
      if (!Platform.isLinux) await trayManager.setToolTip('BlueAIBridge');
      trayManager.addListener(this);
      available = true;
      await _menu();
      state.addListener(_menu);
    } catch (_) {
      available = false; // no tray on this desktop (e.g. GNOME without the AppIndicator extension)
    }
  }

  Future<void> _menu() async {
    final s = _state;
    final status = s.health == null ? 'Broker not running' : 'Running · v${s.health!.version} · port ${s.health!.port}';
    final stats = s.summary == null ? '' : '${s.summary!.messages} messages · ${s.summary!.openLinks} open · ${s.summary!.failed} failed (24h)';
    final key = '$status|$stats';
    if (key == _lastMenu) return;
    _lastMenu = key;
    await trayManager.setContextMenu(
      Menu(
        items: [
          MenuItem(label: status, disabled: true),
          if (stats.isNotEmpty) MenuItem(label: stats, disabled: true),
          MenuItem.separator(),
          MenuItem(key: 'open', label: 'Open BlueAIBridge'),
          MenuItem(key: 'conversations', label: 'Conversations'),
          MenuItem(key: 'health', label: 'Health'),
          MenuItem(key: 'web', label: 'Open in browser'),
          MenuItem.separator(),
          MenuItem(key: 'quit', label: 'Quit BlueAIBridge'),
        ],
      ),
    );
  }

  Future<void> _show([AppPage? page]) async {
    if (page != null) _state.setPage(page);
    await windowManager.show();
    await windowManager.focus();
  }

  @override
  void onTrayIconMouseDown() => Platform.isWindows ? _show() : trayManager.popUpContextMenu();

  @override
  void onTrayIconRightMouseDown() => trayManager.popUpContextMenu();

  @override
  void onTrayMenuItemClick(MenuItem menuItem) async {
    switch (menuItem.key) {
      case 'open':
        await _show();
      case 'conversations':
        await _show(AppPage.conversations);
      case 'health':
        await _show(AppPage.health);
      case 'web':
        await _state.broker.openWebDashboard();
      case 'quit':
        await trayManager.destroy();
        await windowManager.destroy();
        exit(0);
    }
  }
}
