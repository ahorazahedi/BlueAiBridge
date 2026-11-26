// The local broker: where it is, how to call it, how to start it, and its
// live event stream (Server-Sent Events). Only ever talks to 127.0.0.1.

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

import 'models.dart';

class BrokerException implements Exception {
  final String message;
  final bool notRunning;
  BrokerException(this.message, {this.notRunning = false});
  @override
  String toString() => message;
}

class Broker {
  Broker._();
  static final Broker instance = Broker._();

  final http.Client _client = http.Client();

  /// ~/.blueaibridge (or BLUE_AI_BRIDGE_HOME)
  String get root {
    final custom = Platform.environment['BLUE_AI_BRIDGE_HOME'];
    if (custom != null && custom.isNotEmpty) return custom;
    final home = Platform.environment['HOME'] ?? Platform.environment['USERPROFILE'] ?? '.';
    return '$home${Platform.pathSeparator}.blueaibridge';
  }

  String _p(List<String> parts) => [root, ...parts].join(Platform.pathSeparator);

  int get port {
    try {
      return int.parse(File(_p(['data', 'broker.port'])).readAsStringSync().trim());
    } catch (_) {
      return 7600;
    }
  }

  String? get token {
    try {
      return File(_p(['data', 'token'])).readAsStringSync().trim();
    } catch (_) {
      return null;
    }
  }

  Uri url(String path) => Uri.parse('http://127.0.0.1:$port$path');

  Map<String, String> get _headers => {if (token != null) 'Authorization': 'Bearer $token'};

  Future<dynamic> _send(String method, String path, {Object? body, Duration timeout = const Duration(seconds: 20)}) async {
    final req = http.Request(method, url(path))..headers.addAll(_headers);
    if (body != null) {
      req.headers['Content-Type'] = 'application/json';
      req.body = jsonEncode(body);
    }
    http.StreamedResponse resp;
    try {
      resp = await _client.send(req).timeout(timeout);
    } on SocketException {
      throw BrokerException("The BlueAIBridge broker isn't running.", notRunning: true);
    } on http.ClientException {
      throw BrokerException("The BlueAIBridge broker isn't running.", notRunning: true);
    } on TimeoutException {
      throw BrokerException('The broker took too long to answer.');
    }
    final text = await resp.stream.bytesToString();
    if (resp.statusCode < 200 || resp.statusCode >= 300) {
      String msg = 'HTTP ${resp.statusCode}';
      try {
        msg = (jsonDecode(text) as Map)['error']?.toString() ?? msg;
      } catch (_) {}
      throw BrokerException(msg);
    }
    return text.isEmpty ? null : jsonDecode(text);
  }

  Future<T> get<T>(String path, T Function(Json) parse, {Duration timeout = const Duration(seconds: 20)}) async =>
      parse((await _send('GET', path, timeout: timeout)) as Json);
  Future<Json> post(String path, [Object body = const {}, Duration timeout = const Duration(minutes: 3)]) async =>
      ((await _send('POST', path, body: body, timeout: timeout)) as Json?) ?? {};
  Future<Json> put(String path, Object body) async => ((await _send('PUT', path, body: body)) as Json?) ?? {};

  Future<List<int>> raw(String path) async {
    final resp = await _client.get(url(path), headers: _headers).timeout(const Duration(minutes: 1));
    if (resp.statusCode != 200) throw BrokerException('HTTP ${resp.statusCode}');
    return resp.bodyBytes;
  }

  // ------------------------------------------------------------------
  // starting the broker

  /// node and the installed runtime CLI, as the installer recorded them.
  ({String node, String cli})? cli() {
    final rt = _p(['runtime', 'current']);
    final cli = [rt, 'dist', 'src', 'cli.js'].join(Platform.pathSeparator);
    if (!File(cli).existsSync()) return null;
    String node = '';
    try {
      node = File([rt, 'node-path'].join(Platform.pathSeparator)).readAsStringSync().trim();
    } catch (_) {}
    if (node.isEmpty || !File(node).existsSync()) {
      final candidates = Platform.isWindows ? [r'C:\Program Files\nodejs\node.exe'] : ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'];
      node = candidates.firstWhere((c) => File(c).existsSync(), orElse: () => '');
    }
    if (node.isEmpty) return null;
    return (node: node, cli: cli);
  }

  Future<void> startBroker() async {
    final c = cli();
    if (c == null) return;
    await Directory(_p(['logs'])).create(recursive: true);
    await Process.start(c.node, ['--no-warnings', c.cli, 'broker'], workingDirectory: root, mode: ProcessStartMode.detached);
  }

  /// The same UI in the browser.
  Future<void> openWebDashboard([String fragment = '']) async {
    final t = token;
    if (t == null) return;
    await launchUrl(url('/auth?token=$t'));
    if (fragment.isNotEmpty) {
      await Future<void>.delayed(const Duration(milliseconds: 800));
      await launchUrl(url('/#/$fragment'));
    }
  }

  // ------------------------------------------------------------------
  // live events

  /// Every bridge event as it happens; reconnects on its own, resuming after the last id.
  /// Emits id -1 when connected and id -2 when the connection drops.
  Stream<BridgeEvent> events() async* {
    var lastId = 0;
    while (true) {
      final client = http.Client();
      try {
        final req = http.Request('GET', url('/api/stream${lastId > 0 ? '?afterId=$lastId' : ''}'))
          ..headers.addAll(_headers)
          ..headers['Accept'] = 'text/event-stream';
        final resp = await client.send(req).timeout(const Duration(seconds: 5));
        if (resp.statusCode != 200) throw BrokerException('stream HTTP ${resp.statusCode}');
        yield const BridgeEvent(id: -1, ts: 0, type: '_connected');
        await for (final line in resp.stream.transform(utf8.decoder).transform(const LineSplitter())) {
          if (!line.startsWith('data: ')) continue;
          try {
            final e = BridgeEvent.fromJson(jsonDecode(line.substring(6)) as Json);
            if (e.id > lastId) lastId = e.id;
            yield e;
          } catch (_) {}
        }
      } catch (_) {
        // fall through to reconnect
      } finally {
        client.close();
      }
      yield const BridgeEvent(id: -2, ts: 0, type: '_disconnected');
      await Future<void>.delayed(const Duration(milliseconds: 2500));
    }
  }
}
