import 'package:blue_ai_bridge/src/api/models.dart';
import 'package:blue_ai_bridge/src/util/format.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('parses a link with its last message and verdict', () {
    final l = Link.fromJson({
      'id': 'L1',
      'kind': 'review',
      'reviewKind': 'code',
      'status': 'answered',
      'requester': {'app': 'claude', 'id': 'c1'},
      'reviewer': {'app': 'codex', 'id': 'x1'},
      'joinCode': null,
      'delivery': 'headless',
      'round': 2,
      'paths': ['/w'],
      'title': 'Average price',
      'ownInitiative': false,
      'fingerprints': {'/w': 'abc'},
      'createdAt': 1000,
      'updatedAt': 2000,
      'closedAt': null,
      'closeReason': null,
      'messageCount': 4,
      'lastMessage': {
        'id': 'M4',
        'linkId': 'L1',
        'kind': 'answer',
        'from': {'app': 'codex', 'id': 'x1'},
        'to': {'app': 'claude', 'id': 'c1'},
        'body': '[APPROVED]',
        'decision': {
          'decision': 'approved',
          'note': 'ok',
          'blocking': [],
          'nits': ['n'],
        },
        'round': 2,
        'replyTo': 'M3',
        'state': 'delivered',
        'channel': 'inline',
        'attempts': 0,
        'error': null,
        'deferredUntil': null,
        'deferReason': null,
        'bytes': 120,
        'createdAt': 1500,
        'deliveredAt': 1510,
        'answeredAt': null,
        'clientId': null,
      },
    });
    expect(l.reviewer!.appName, 'ChatGPT');
    expect(l.lastMessage!.decision!.approved, isTrue);
    expect(l.lastMessage!.latencyMs, 10);
    expect(l.fingerprints['/w'], 'abc');
  });

  test('parses a summary', () {
    final s = Summary.fromJson({
      'range': '24h',
      'messages': 23,
      'bytes': 7200,
      'failed': 1,
      'avgDeliveryMs': 1.4,
      'avgReviewMs': null,
      'openLinks': 2,
      'pending': 2,
      'autosOn': 1,
      'clients': 11,
      'decisions': {'approved': 2, 'changes_requested': 1},
      'byChannel': [
        {'channel': 'headless', 'messages': 11, 'bytes': 4000},
      ],
      'byDirection': [
        {'from': 'claude', 'to': 'codex', 'messages': 11, 'bytes': 5000},
      ],
      'version': '1.0.0',
      'startedAt': 1795647211928,
    });
    expect(s.approved, 2);
    expect(s.changesRequested, 1);
    expect(s.byDirection.single.bytes, 5000);
  });

  test('config round-trips and compares by value', () {
    final c = BridgeConfig.fromJson({
      'port': 7600,
      'delivery': 'auto',
      'autoReviews': 'key-moments',
      'openClosedApps': 'ask',
      'readChatsInReviewers': 'deny',
      'maxRounds': 20,
      'chatgptModel': '',
      'chatgptEffort': '',
      'claudeModel': '',
      'headlessTimeoutSec': 900,
      'retentionDays': 30,
      'includeDiff': false,
    });
    final d = c.copy();
    expect(d == c, isTrue);
    d.maxRounds = 5;
    expect(d == c, isFalse);
    expect(d.toJson()['maxRounds'], 5);
  });

  test('formatting matches the other apps', () {
    expect(Fmt.bytes(0), 'Zero KB');
    expect(Fmt.bytes(68), '68 bytes');
    expect(Fmt.bytes(7200), '7.2 KB');
    expect(Fmt.duration(850), '850 ms');
    expect(Fmt.duration(12500), '13 s');
    expect(Fmt.duration(125000), '2m 5s');
    expect(Fmt.shortId('7f3c2a10-5b1e-4c55-9d1a-2f0c9a7e11aa'), '7f3c2a10…11aa');
    expect(Fmt.appName('codex'), 'ChatGPT');
    expect(Fmt.kindLabel('turn'), 'Turn review');
  });
}
