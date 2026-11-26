// App-wide state: connection, live events, navigation, and a debounced
// "something changed" counter that pages reload on.

import 'dart:async';

import 'package:flutter/foundation.dart' hide Summary;
import 'package:shared_preferences/shared_preferences.dart';

import '../api/broker.dart';
import '../api/models.dart';

enum AppPage { overview, conversations, traffic, activity, chats, clients, health, settings }

extension PageInfo on AppPage {
  String get title => const {
    AppPage.overview: 'Overview',
    AppPage.conversations: 'Conversations',
    AppPage.traffic: 'Traffic',
    AppPage.activity: 'Activity',
    AppPage.chats: 'Chat Library',
    AppPage.clients: 'Clients & Install',
    AppPage.health: 'Health',
    AppPage.settings: 'Settings',
  }[this]!;
  bool get isMonitor => index <= AppPage.chats.index;
}

enum TimeRange { h1, h6, h24, d7, d30 }

extension RangeInfo on TimeRange {
  String get label => const ['1h', '6h', '24h', '7d', '30d'][index];
  double get seconds => const [3600.0, 21600.0, 86400.0, 604800.0, 2592000.0][index];
}

enum Connection { connecting, live, down }

class Toast {
  final String title;
  final String? body;
  final bool isError;
  final int id;
  Toast(this.title, this.body, this.isError, this.id);
}

class AppState extends ChangeNotifier {
  final Broker broker = Broker.instance;

  AppPage page = AppPage.overview;
  TimeRange range = TimeRange.h24;
  Connection connection = Connection.connecting;
  Health? health;
  Summary? summary;
  final List<BridgeEvent> events = [];
  int tick = 0;
  String? selectedLink;
  String? selectedChat;
  Toast? toast;

  bool _started = false;
  Timer? _debounce;
  Timer? _poll;
  StreamSubscription<BridgeEvent>? _sub;
  int _toastSeq = 0;

  Future<void> start() async {
    if (_started) return;
    _started = true;
    try {
      final prefs = await SharedPreferences.getInstance();
      final r = prefs.getString('range');
      range = TimeRange.values.firstWhere((x) => x.label == r, orElse: () => TimeRange.h24);
    } catch (_) {}
    await refreshCore();
    _sub = broker.events().listen((e) {
      if (e.type == '_connected') {
        connection = Connection.live;
        refreshCore();
      } else if (e.type == '_disconnected') {
        if (connection != Connection.down) {
          connection = Connection.down;
          health = null;
          notifyListeners();
        }
      } else {
        events.insert(0, e);
        if (events.length > 1500) events.removeRange(1500, events.length);
        _bump();
      }
    });
    _poll = Timer.periodic(const Duration(seconds: 30), (_) => refreshCore());
  }

  void _bump() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      tick++;
      refreshCore();
    });
  }

  void reload() {
    tick++;
    refreshCore();
  }

  Future<void> refreshCore() async {
    try {
      health = await broker.get('/api/health', Health.fromJson, timeout: const Duration(seconds: 3));
      try {
        summary = await broker.get('/api/summary?range=24h', Summary.fromJson);
      } catch (_) {}
      if (connection == Connection.down) connection = Connection.connecting;
      if (events.isEmpty) {
        try {
          final r = await broker.get('/api/events?limit=300', (j) => (j['events'] as List).map((e) => BridgeEvent.fromJson(e)).toList());
          events.addAll(r);
        } catch (_) {}
      }
    } catch (_) {
      health = null;
      connection = Connection.down;
    }
    notifyListeners();
  }

  void setPage(AppPage p) {
    page = p;
    notifyListeners();
  }

  void setRange(TimeRange r) {
    range = r;
    SharedPreferences.getInstance().then((p) => p.setString('range', r.label)).catchError((_) => true);
    notifyListeners();
  }

  void open(AppPage p, {String? link, String? chat}) {
    if (link != null) selectedLink = link;
    if (chat != null) selectedChat = chat;
    page = p;
    notifyListeners();
  }

  void selectLink(String id) {
    selectedLink = id;
    notifyListeners();
  }

  void selectChat(String key) {
    selectedChat = key;
    notifyListeners();
  }

  void notify(String title, [String? body, bool error = false]) {
    final id = ++_toastSeq;
    toast = Toast(title, body, error, id);
    notifyListeners();
    Timer(Duration(seconds: error ? 8 : 4), () {
      if (toast?.id == id) {
        toast = null;
        notifyListeners();
      }
    });
  }

  void dismissToast() {
    toast = null;
    notifyListeners();
  }

  Future<void> startBroker() async {
    await broker.startBroker();
    await Future<void>.delayed(const Duration(milliseconds: 1500));
    await refreshCore();
  }

  @override
  void dispose() {
    _sub?.cancel();
    _poll?.cancel();
    _debounce?.cancel();
    super.dispose();
  }
}
