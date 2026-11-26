// Wire models for the broker's HTTP API (the same shapes the web dashboard
// and the macOS app use).

typedef Json = Map<String, dynamic>;

double _d(dynamic v) => v == null ? 0 : (v as num).toDouble();
double? _dn(dynamic v) => v == null ? null : (v as num).toDouble();
int _i(dynamic v) => v == null ? 0 : (v as num).toInt();
String? _s(dynamic v) => v as String?;
List<String> _ls(dynamic v) => v == null ? const [] : (v as List).map((e) => e.toString()).toList();

class Endpoint {
  final String app;
  final String id;
  const Endpoint(this.app, this.id);
  static Endpoint? fromJson(dynamic j) => j == null ? null : Endpoint(j['app'] as String, j['id'] as String);
  String get key => '$app:$id';
  String get appName => app == 'claude' ? 'Claude' : 'ChatGPT';
  @override
  bool operator ==(Object other) => other is Endpoint && other.key == key;
  @override
  int get hashCode => key.hashCode;
}

class Health {
  final bool ok;
  final String? version;
  final int? pid;
  final int? port;
  final double? startedAt;
  Health.fromJson(Json j)
    : ok = j['ok'] == true,
      version = _s(j['version']),
      pid = j['pid'] == null ? null : _i(j['pid']),
      port = j['port'] == null ? null : _i(j['port']),
      startedAt = _dn(j['startedAt']);
}

class DirectionRow {
  final String from, to;
  final int messages, bytes;
  DirectionRow.fromJson(Json j) : from = j['from'] as String, to = j['to'] as String, messages = _i(j['messages']), bytes = _i(j['bytes']);
}

class ChannelRow {
  final String channel;
  final int messages, bytes;
  ChannelRow.fromJson(Json j) : channel = j['channel'] as String, messages = _i(j['messages']), bytes = _i(j['bytes']);
}

class Summary {
  final String range;
  final int messages, bytes, failed, openLinks, pending, autosOn, clients;
  final double? avgDeliveryMs, avgReviewMs;
  final Map<String, int> decisions;
  final List<ChannelRow> byChannel;
  final List<DirectionRow> byDirection;
  final String version;
  final double startedAt;
  Summary.fromJson(Json j)
    : range = j['range'] as String,
      messages = _i(j['messages']),
      bytes = _i(j['bytes']),
      failed = _i(j['failed']),
      openLinks = _i(j['openLinks']),
      pending = _i(j['pending']),
      autosOn = _i(j['autosOn']),
      clients = _i(j['clients']),
      avgDeliveryMs = _dn(j['avgDeliveryMs']),
      avgReviewMs = _dn(j['avgReviewMs']),
      decisions = (j['decisions'] as Map? ?? {}).map((k, v) => MapEntry(k as String, _i(v))),
      byChannel = (j['byChannel'] as List? ?? []).map((e) => ChannelRow.fromJson(e)).toList(),
      byDirection = (j['byDirection'] as List? ?? []).map((e) => DirectionRow.fromJson(e)).toList(),
      version = j['version'] as String? ?? '',
      startedAt = _d(j['startedAt']);
  int get approved => decisions['approved'] ?? 0;
  int get changesRequested => decisions['changes_requested'] ?? 0;
}

class SeriesPoint {
  final double t;
  final int claudeToChatgpt, chatgptToClaude, bridge, bytes, failed;
  const SeriesPoint(this.t, this.claudeToChatgpt, this.chatgptToClaude, this.bridge, this.bytes, this.failed);
  SeriesPoint.fromJson(Json j)
    : t = _d(j['t']),
      claudeToChatgpt = _i(j['claudeToChatgpt']),
      chatgptToClaude = _i(j['chatgptToClaude']),
      bridge = _i(j['bridge']),
      bytes = _i(j['bytes']),
      failed = _i(j['failed']);
  int get total => claudeToChatgpt + chatgptToClaude + bridge;
  DateTime get date => DateTime.fromMillisecondsSinceEpoch(t.toInt());
}

class Series {
  final double bucketMs;
  final List<SeriesPoint> points;
  Series.fromJson(Json j) : bucketMs = _d(j['bucketMs']), points = (j['points'] as List).map((e) => SeriesPoint.fromJson(e)).toList();
}

class Decision {
  final String decision, note;
  final List<String> blocking, nits;
  Decision.fromJson(Json j) : decision = j['decision'] as String, note = j['note'] as String? ?? '', blocking = _ls(j['blocking']), nits = _ls(j['nits']);
  bool get approved => decision == 'approved';
}

class Message {
  final String id, kind, body, state;
  final String? linkId, channel, error, deferReason;
  final Endpoint? from, to;
  final Decision? decision;
  final int round, attempts, bytes;
  final double createdAt;
  final double? deliveredAt, answeredAt;
  Message.fromJson(Json j)
    : id = j['id'] as String,
      linkId = _s(j['linkId']),
      kind = j['kind'] as String,
      from = Endpoint.fromJson(j['from']),
      to = Endpoint.fromJson(j['to']),
      body = j['body'] as String? ?? '',
      decision = j['decision'] == null ? null : Decision.fromJson(j['decision']),
      round = _i(j['round']),
      state = j['state'] as String,
      channel = _s(j['channel']),
      attempts = _i(j['attempts']),
      error = _s(j['error']),
      deferReason = _s(j['deferReason']),
      bytes = _i(j['bytes']),
      createdAt = _d(j['createdAt']),
      deliveredAt = _dn(j['deliveredAt']),
      answeredAt = _dn(j['answeredAt']);
  double? get latencyMs => deliveredAt == null ? null : deliveredAt! - createdAt;
}

class Link {
  final String id, kind, status, delivery, title;
  final String? reviewKind, joinCode, closeReason;
  final Endpoint requester;
  final Endpoint? reviewer;
  final int round;
  final List<String> paths;
  final bool ownInitiative;
  final Map<String, String> fingerprints;
  final double createdAt, updatedAt;
  final double? closedAt;
  final int? messageCount;
  final Message? lastMessage;
  Link.fromJson(Json j)
    : id = j['id'] as String,
      kind = j['kind'] as String,
      reviewKind = _s(j['reviewKind']),
      status = j['status'] as String,
      requester = Endpoint.fromJson(j['requester'])!,
      reviewer = Endpoint.fromJson(j['reviewer']),
      joinCode = _s(j['joinCode']),
      delivery = j['delivery'] as String,
      round = _i(j['round']),
      paths = _ls(j['paths']),
      title = j['title'] as String? ?? '',
      ownInitiative = j['ownInitiative'] == true,
      fingerprints = (j['fingerprints'] as Map? ?? {}).map((k, v) => MapEntry(k as String, v.toString())),
      createdAt = _d(j['createdAt']),
      updatedAt = _d(j['updatedAt']),
      closedAt = _dn(j['closedAt']),
      closeReason = _s(j['closeReason']),
      messageCount = j['messageCount'] == null ? null : _i(j['messageCount']),
      lastMessage = j['lastMessage'] == null ? null : Message.fromJson(j['lastMessage']);
}

class ClientInfo {
  final String app, id, surface;
  final String? cwd, title, hostId;
  final double firstSeen, lastSeen;
  final bool? listening;
  ClientInfo.fromJson(Json j)
    : app = j['app'] as String,
      id = j['id'] as String,
      surface = j['surface'] as String? ?? 'unknown',
      cwd = _s(j['cwd']),
      title = _s(j['title']),
      hostId = _s(j['hostId']),
      firstSeen = _d(j['firstSeen']),
      lastSeen = _d(j['lastSeen']),
      listening = j['listening'] as bool?;
  Endpoint get endpoint => Endpoint(app, id);
}

class BridgeEvent {
  final int id;
  final double ts;
  final String type;
  final String? linkId, messageId, actor;
  final int bytes;
  final Json data;
  const BridgeEvent({required this.id, required this.ts, required this.type, this.linkId, this.messageId, this.actor, this.bytes = 0, this.data = const {}});
  BridgeEvent.fromJson(Json j)
    : id = _i(j['id']),
      ts = _d(j['ts']),
      type = j['type'] as String,
      linkId = _s(j['linkId']),
      messageId = _s(j['messageId']),
      actor = _s(j['actor']),
      bytes = _i(j['bytes']),
      data = (j['data'] as Map?)?.cast<String, dynamic>() ?? const {};
}

class LinkDetail {
  final Link link;
  final List<Message> messages;
  final List<BridgeEvent> events;
  final ClientInfo? requester, reviewer;
  LinkDetail.fromJson(Json j)
    : link = Link.fromJson(j['link']),
      messages = (j['messages'] as List).map((e) => Message.fromJson(e)).toList(),
      events = (j['events'] as List).map((e) => BridgeEvent.fromJson(e)).toList(),
      requester = j['requester'] == null ? null : ClientInfo.fromJson(j['requester']),
      reviewer = j['reviewer'] == null ? null : ClientInfo.fromJson(j['reviewer']);
}

class InstallClient {
  final String id, name;
  final bool detected;
  final String? path;
  InstallClient.fromJson(Json j) : id = j['id'] as String, name = j['name'] as String, detected = j['detected'] == true, path = _s(j['path']);
}

class InstallTarget {
  final String id, name;
  final bool installed, partial;
  final Json details;
  final List<InstallClient> clients;
  InstallTarget.fromJson(Json j)
    : id = j['id'] as String,
      name = j['name'] as String,
      installed = j['installed'] == true,
      partial = j['partial'] == true,
      details = (j['details'] as Map?)?.cast<String, dynamic>() ?? const {},
      clients = (j['clients'] as List? ?? []).map((e) => InstallClient.fromJson(e)).toList();
}

class InstallStatus {
  final String version;
  final bool runtimeInstalled, runtimeUpToDate;
  final String? runtimeVersion;
  final String runtimePath;
  final List<InstallTarget> targets;
  InstallStatus.fromJson(Json j)
    : version = j['version'] as String,
      runtimeInstalled = j['runtime']['installed'] == true,
      runtimeUpToDate = j['runtime']['upToDate'] == true,
      runtimeVersion = _s(j['runtime']['version']),
      runtimePath = j['runtime']['path'] as String? ?? '',
      targets = (j['targets'] as List).map((e) => InstallTarget.fromJson(e)).toList();
}

class InstallStep {
  final String target, message;
  final bool ok;
  InstallStep.fromJson(Json j) : target = j['target'] as String, message = j['message'] as String, ok = j['ok'] == true;
}

class InstallResult {
  final bool ok;
  final String action;
  final List<InstallStep> steps;
  final String? backupDir;
  InstallResult.fromJson(Json j)
    : ok = j['ok'] == true,
      action = j['action'] as String,
      steps = (j['steps'] as List).map((e) => InstallStep.fromJson(e)).toList(),
      backupDir = _s(j['backupDir']);
}

class Check {
  final String group, name, status, detail;
  final String? fix;
  Check.fromJson(Json j)
    : group = j['group'] as String,
      name = j['name'] as String,
      status = j['status'] as String,
      detail = j['detail'] as String,
      fix = _s(j['fix']);
}

class DoctorResult {
  final List<Check> checks;
  final bool ok;
  final Map<String, int> summary;
  DoctorResult.fromJson(Json j)
    : checks = (j['checks'] as List).map((e) => Check.fromJson(e)).toList(),
      ok = j['ok'] == true,
      summary = (j['summary'] as Map).map((k, v) => MapEntry(k as String, _i(v)));
}

class ChatSummary {
  final String app, id, title;
  final String? cwd;
  final double updatedAt;
  final int size;
  ChatSummary.fromJson(Json j)
    : app = j['app'] as String,
      id = j['id'] as String,
      title = j['title'] as String? ?? '',
      cwd = _s(j['cwd']),
      updatedAt = _d(j['updatedAt']),
      size = _i(j['size']);
  String get key => '$app:$id';
}

class ChatMessage {
  final String role, text;
  final double? ts;
  final bool cut;
  ChatMessage.fromJson(Json j) : role = j['role'] as String, text = j['text'] as String? ?? '', ts = _dn(j['ts']), cut = j['cut'] == true;
}

class ChatPage {
  final String app, id, title;
  final String? cwd, nextCursor;
  final int total, start, end;
  final List<ChatMessage> messages;
  final List<String> notes;
  ChatPage.fromJson(Json j)
    : app = j['app'] as String,
      id = j['id'] as String,
      title = j['title'] as String? ?? '',
      cwd = _s(j['cwd']),
      total = _i(j['total']),
      start = _i(j['start']),
      end = _i(j['end']),
      messages = (j['messages'] as List).map((e) => ChatMessage.fromJson(e)).toList(),
      nextCursor = _s(j['nextCursor']),
      notes = _ls(j['notes']);
}

class LimitWindow {
  final double usedPercent;
  final double? resetsAt;
  LimitWindow.fromJson(Json j) : usedPercent = _d(j['usedPercent']), resetsAt = _dn(j['resetsAt']);
}

class Limits {
  final bool blocked, credits;
  final LimitWindow? primary, secondary;
  Limits.fromJson(Json j)
    : blocked = j['blocked'] == true,
      credits = j['credits'] == true,
      primary = j['primary'] == null ? null : LimitWindow.fromJson(j['primary']),
      secondary = j['secondary'] == null ? null : LimitWindow.fromJson(j['secondary']);
}

/// config.json, edited in Settings.
class BridgeConfig {
  int port, maxRounds, headlessTimeoutSec, retentionDays;
  String delivery, autoReviews, openClosedApps, readChatsInReviewers, chatgptModel, chatgptEffort, claudeModel;
  bool includeDiff;
  BridgeConfig.fromJson(Json j)
    : port = _i(j['port']),
      maxRounds = _i(j['maxRounds']),
      headlessTimeoutSec = _i(j['headlessTimeoutSec']),
      retentionDays = _i(j['retentionDays']),
      delivery = j['delivery'] as String,
      autoReviews = j['autoReviews'] as String,
      openClosedApps = j['openClosedApps'] as String,
      readChatsInReviewers = j['readChatsInReviewers'] as String,
      chatgptModel = j['chatgptModel'] as String? ?? '',
      chatgptEffort = j['chatgptEffort'] as String? ?? '',
      claudeModel = j['claudeModel'] as String? ?? '',
      includeDiff = j['includeDiff'] == true;
  Json toJson() => {
    'port': port,
    'maxRounds': maxRounds,
    'headlessTimeoutSec': headlessTimeoutSec,
    'retentionDays': retentionDays,
    'delivery': delivery,
    'autoReviews': autoReviews,
    'openClosedApps': openClosedApps,
    'readChatsInReviewers': readChatsInReviewers,
    'chatgptModel': chatgptModel,
    'chatgptEffort': chatgptEffort,
    'claudeModel': claudeModel,
    'includeDiff': includeDiff,
  };
  BridgeConfig copy() => BridgeConfig.fromJson(toJson());
  @override
  bool operator ==(Object other) => other is BridgeConfig && other.toJson().toString() == toJson().toString();
  @override
  int get hashCode => toJson().toString().hashCode;
}
