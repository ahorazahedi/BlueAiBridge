// Dev-only: with BLUE_AI_BRIDGE_SCREENSHOTS=<dir>, visit each page, save the
// window as <dir>/<page>.png, and quit. Used to regenerate README screenshots
// (`npm run screenshots`); it needs no OS screen-recording permission because
// the app renders its own window.

import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:material_ui/material_ui.dart';

import 'state/app_state.dart';

final screenshotKey = GlobalKey();

Future<void> runScreenshots(AppState state, String dir) async {
  await Directory(dir).create(recursive: true);
  await Future<void>.delayed(const Duration(seconds: 3));
  final plan = <(String, AppPage, String?)>[
    ('overview', AppPage.overview, null),
    ('conversations', AppPage.conversations, Platform.environment['BLUE_AI_BRIDGE_SCREENSHOT_LINK'] ?? 'L1'),
    ('traffic', AppPage.traffic, null),
    ('activity', AppPage.activity, null),
    ('clients', AppPage.clients, null),
    ('settings', AppPage.settings, null),
  ];
  for (final (name, page, link) in plan) {
    state.open(page, link: link);
    await Future<void>.delayed(const Duration(milliseconds: 2500));
    final boundary = screenshotKey.currentContext?.findRenderObject() as RenderRepaintBoundary?;
    if (boundary == null) continue;
    final image = await boundary.toImage(pixelRatio: 2);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    if (bytes != null) await File('$dir${Platform.pathSeparator}$name.png').writeAsBytes(bytes.buffer.asUint8List());
  }
  exit(0);
}
