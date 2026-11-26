// ignore_for_file: deprecated_member_use
// The main window: a sidebar that runs up into the title bar (as on macOS),
// a toolbar row, the current page, toasts, and window buttons drawn in each
// OS's own style on Windows and Linux.

import 'dart:io';

import 'package:material_ui/material_ui.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';
import 'package:window_manager/legacy.dart';

import 'pages/activity.dart';
import 'pages/conversations.dart';
import 'pages/manage.dart';
import 'pages/overview.dart';
import 'pages/traffic.dart';
import 'state/app_state.dart';
import 'theme/tokens.dart';
import 'util/format.dart';
import 'widgets/components.dart';

const _icons = {
  AppPage.overview: LucideIcons.layoutGrid,
  AppPage.conversations: LucideIcons.messagesSquare,
  AppPage.traffic: LucideIcons.arrowUpDown,
  AppPage.activity: LucideIcons.activity,
  AppPage.chats: LucideIcons.libraryBig,
  AppPage.clients: LucideIcons.monitor,
  AppPage.health: LucideIcons.stethoscope,
  AppPage.settings: LucideIcons.settings,
};

class Shell extends StatelessWidget {
  const Shell({super.key});

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final t = context.t;
    final mod = Platform.isMacOS ? LogicalKeyboardKey.meta : LogicalKeyboardKey.control;
    return CallbackShortcuts(
      bindings: {
        for (final p in AppPage.values) LogicalKeySet(mod, LogicalKeyboardKey(LogicalKeyboardKey.digit1.keyId + p.index)): () => app.setPage(p),
        LogicalKeySet(mod, LogicalKeyboardKey.keyR): app.reload,
      },
      child: Focus(
        autofocus: true,
        child: Scaffold(
          backgroundColor: t.window,
          body: Stack(
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const _Sidebar(),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const _Toolbar(),
                        Expanded(child: app.connection == Connection.down && app.health == null ? const _Offline() : _page(app.page)),
                      ],
                    ),
                  ),
                ],
              ),
              const Positioned(right: 20, bottom: 20, child: _ToastView()),
            ],
          ),
        ),
      ),
    );
  }

  Widget _page(AppPage p) => switch (p) {
    AppPage.overview => const OverviewPage(),
    AppPage.conversations => const ConversationsPage(),
    AppPage.traffic => const TrafficPage(),
    AppPage.activity => const ActivityPage(),
    AppPage.chats => const ChatsPage(),
    AppPage.clients => const ClientsPage(),
    AppPage.health => const HealthPage(),
    AppPage.settings => const SettingsPage(),
  };
}

class _Sidebar extends StatelessWidget {
  const _Sidebar();
  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final t = context.t;
    Widget section(String label) => Padding(
      padding: const EdgeInsets.fromLTRB(18, 14, 18, 6),
      child: Text(
        label,
        style: T.caption.copyWith(color: t.text3, fontWeight: FontWeight.w600),
      ),
    );
    Widget item(AppPage p) {
      final sel = app.page == p;
      final badge = p == AppPage.conversations ? (app.summary?.openLinks ?? 0) : 0;
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 1),
        child: Material(
          color: sel ? t.selection : Colors.transparent,
          borderRadius: BorderRadius.circular(7),
          child: InkWell(
            borderRadius: BorderRadius.circular(7),
            onTap: () => app.setPage(p),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              child: Row(
                children: [
                  Icon(_icons[p], size: 16, color: sel ? Colors.white : t.accent),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(p.title, style: T.body.copyWith(color: sel ? Colors.white : t.text)),
                  ),
                  if (badge > 0) Text('$badge', style: T.caption.copyWith(color: sel ? Colors.white70 : t.text3)),
                ],
              ),
            ),
          ),
        ),
      );
    }

    final live = app.connection == Connection.live;
    final down = app.connection == Connection.down;
    return Padding(
      padding: const EdgeInsets.all(8),
      child: Container(
        width: 240,
        decoration: BoxDecoration(
          color: t.sidebar,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: t.cardBorder.withValues(alpha: 0.6)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // title-bar row: macOS keeps its own traffic lights here; elsewhere the app name
            DragToMoveArea(
              child: SizedBox(
                height: 44,
                child: Platform.isMacOS
                    ? const SizedBox()
                    : Padding(
                        padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                        child: Row(
                          children: [
                            const Avatar(null, size: 22),
                            const SizedBox(width: 8),
                            Text('BlueAIBridge', style: T.calloutStrong.copyWith(color: t.text)),
                          ],
                        ),
                      ),
              ),
            ),
            section('Monitor'),
            for (final p in AppPage.values.where((p) => p.isMonitor)) item(p),
            section('Manage'),
            for (final p in AppPage.values.where((p) => !p.isMonitor)) item(p),
            const Spacer(),
            Divider(indent: 14, endIndent: 14, color: t.separator),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 7,
                        height: 7,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: live
                              ? t.good
                              : down
                              ? t.critical
                              : t.text3,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        live
                            ? 'Broker connected'
                            : down
                            ? 'Broker unreachable'
                            : 'Connecting…',
                        style: T.caption,
                      ),
                    ],
                  ),
                  if (app.health?.version != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Text(
                        'v${app.health!.version} · port ${app.health!.port}${app.health!.startedAt != null ? ' · up ${Fmt.duration(DateTime.now().millisecondsSinceEpoch - app.health!.startedAt!)}' : ''}',
                        style: T.caption2.copyWith(color: t.text3),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Toolbar extends StatelessWidget {
  const _Toolbar();
  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final t = context.t;
    final subtitle = switch (app.connection) {
      Connection.live => 'Live',
      Connection.connecting => 'Connecting…',
      Connection.down => 'Broker not running',
    };
    return DragToMoveArea(
      child: SizedBox(
        height: 60,
        child: Padding(
          padding: EdgeInsets.only(left: 12, right: Platform.isMacOS ? 16 : 6, top: 4),
          child: Row(
            children: [
              Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(app.page.title, style: T.headline),
                  Text(subtitle, style: T.caption.copyWith(color: t.text3)),
                ],
              ),
              const Spacer(),
              if (app.page == AppPage.overview || app.page == AppPage.traffic)
                Segmented<TimeRange>(value: app.range, large: true, options: [for (final r in TimeRange.values) (r, r.label)], onChanged: app.setRange),
              const SizedBox(width: 10),
              Container(
                decoration: BoxDecoration(
                  color: Theme.of(context).brightness == Brightness.dark ? const Color(0xFF2C2C2E) : const Color(0xFFE3E3E6),
                  borderRadius: BorderRadius.circular(999),
                ),
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                child: Row(
                  children: [
                    IconBtn(LucideIcons.rotateCw, tooltip: Platform.isMacOS ? 'Reload (⌘R)' : 'Reload (Ctrl+R)', onPressed: app.reload, size: 16),
                    IconBtn(LucideIcons.compass, tooltip: 'Open in browser', onPressed: () => app.broker.openWebDashboard(), size: 16),
                  ],
                ),
              ),
              if (!Platform.isMacOS) ...[const SizedBox(width: 10), const _WindowButtons()],
            ],
          ),
        ),
      ),
    );
  }
}

/// Minimize / maximize / close, drawn in the current OS's style (Windows: flat
/// rectangles, close turns red; Linux: round GNOME-style buttons).
class _WindowButtons extends StatefulWidget {
  const _WindowButtons();
  @override
  State<_WindowButtons> createState() => _WindowButtonsState();
}

class _WindowButtonsState extends State<_WindowButtons> {
  @override
  Widget build(BuildContext context) {
    final t = context.t;
    if (Platform.isWindows) {
      Widget b(IconData i, VoidCallback on, {bool close = false}) => _HoverBox(
        hover: close ? const Color(0xFFC42B1C) : t.text.withValues(alpha: 0.08),
        hoverFg: close ? Colors.white : t.text,
        builder: (fg) => SizedBox(width: 46, height: 32, child: Icon(i, size: 15, color: fg ?? t.text2)),
        onTap: on,
      );
      return Row(
        children: [
          b(LucideIcons.minus, () => windowManager.minimize()),
          b(LucideIcons.square, () async => await windowManager.isMaximized() ? windowManager.unmaximize() : windowManager.maximize()),
          b(LucideIcons.x, () => windowManager.close(), close: true),
        ],
      );
    }
    Widget b(IconData i, VoidCallback on) => Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: _HoverBox(
        hover: t.text.withValues(alpha: 0.16),
        radius: 999,
        builder: (fg) => Container(
          width: 24,
          height: 24,
          decoration: BoxDecoration(shape: BoxShape.circle, color: t.text.withValues(alpha: 0.08)),
          child: Icon(i, size: 13, color: t.text),
        ),
        onTap: on,
      ),
    );
    return Row(
      children: [
        b(LucideIcons.minus, () => windowManager.minimize()),
        b(LucideIcons.square, () async => await windowManager.isMaximized() ? windowManager.unmaximize() : windowManager.maximize()),
        b(LucideIcons.x, () => windowManager.close()),
      ],
    );
  }
}

class _HoverBox extends StatefulWidget {
  final Color hover;
  final Color? hoverFg;
  final double radius;
  final Widget Function(Color? fg) builder;
  final VoidCallback onTap;
  const _HoverBox({required this.hover, this.hoverFg, this.radius = 0, required this.builder, required this.onTap});
  @override
  State<_HoverBox> createState() => _HoverBoxState();
}

class _HoverBoxState extends State<_HoverBox> {
  bool on = false;
  @override
  Widget build(BuildContext context) => MouseRegion(
    onEnter: (_) => setState(() => on = true),
    onExit: (_) => setState(() => on = false),
    child: GestureDetector(
      onTap: widget.onTap,
      child: Container(
        decoration: BoxDecoration(color: on ? widget.hover : Colors.transparent, borderRadius: BorderRadius.circular(widget.radius)),
        child: widget.builder(on ? widget.hoverFg : null),
      ),
    ),
  );
}

class _Offline extends StatelessWidget {
  const _Offline();
  @override
  Widget build(BuildContext context) {
    final app = context.read<AppState>();
    final installed = app.broker.cli() != null;
    return EmptyState(
      icon: LucideIcons.unplug,
      title: "The broker isn't running",
      message: installed
          ? 'It starts on its own when a chat uses BlueAIBridge, or keeps running with the background service.'
          : "BlueAIBridge isn't installed yet. In its folder run: node dist/src/cli.js install",
      action: installed ? Btn('Start broker', primary: true, onPressed: app.startBroker) : null,
    );
  }
}

class _ToastView extends StatelessWidget {
  const _ToastView();
  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final t = context.t;
    final toast = app.toast;
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 180),
      child: toast == null
          ? const SizedBox.shrink()
          : Container(
              key: ValueKey(toast.id),
              constraints: const BoxConstraints(maxWidth: 380),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: t.card,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: t.cardBorder),
                boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.25), blurRadius: 18, offset: const Offset(0, 6))],
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(toast.isError ? LucideIcons.octagonX : LucideIcons.circleCheck, size: 17, color: toast.isError ? t.critical : t.good),
                  const SizedBox(width: 10),
                  Flexible(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(toast.title, style: T.calloutStrong),
                        if (toast.body != null) Text(toast.body!, style: T.caption.copyWith(color: t.text3)),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconBtn(LucideIcons.x, tooltip: 'Dismiss', size: 12, onPressed: app.dismissToast),
                ],
              ),
            ),
    );
  }
}
