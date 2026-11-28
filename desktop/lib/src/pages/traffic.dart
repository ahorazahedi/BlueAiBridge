import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/app_state.dart';
import '../theme/tokens.dart';
import '../util/format.dart';
import '../widgets/components.dart';
import '../widgets/loader.dart';
import '../widgets/markdown.dart';
import 'activity.dart' show exportFile;
import 'conversations.dart' show DecisionView;

const _pageSize = 100;

class _TrafficData {
  final List<Message> messages;
  final Summary summary;
  _TrafficData(this.messages, this.summary);
}

class TrafficPage extends StatefulWidget {
  const TrafficPage({super.key});
  @override
  State<TrafficPage> createState() => _TrafficPageState();
}

class _TrafficPageState extends State<TrafficPage> {
  String search = '', state = '', kind = '';
  int page = 0;
  String? selected;
  String sortCol = 'time';
  bool asc = false;
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final t = context.t;
    return Loader<_TrafficData>(
      reloadKey: '${app.range.label}|$search|$state|$kind|$page',
      load: () async {
        final since = (DateTime.now().millisecondsSinceEpoch - app.range.seconds * 1000).round();
        final m = app.broker.get(
          '/api/messages?since=$since&limit=$_pageSize&offset=${page * _pageSize}&state=$state&kind=$kind&q=${Uri.encodeQueryComponent(search)}',
          (j) => (j['messages'] as List).map((e) => Message.fromJson(e)).toList(),
        );
        final s = app.broker.get('/api/summary?range=${app.range.label}', Summary.fromJson);
        await Future.wait([m, s]); // so a failure of one isn't left unhandled while awaiting another
        return _TrafficData(await m, await s);
      },
      builder: (context, d, error, reload) {
        final rows = [...?d?.messages];
        int cmp(Message a, Message b) => switch (sortCol) {
          'size' => a.bytes.compareTo(b.bytes),
          'kind' => a.kind.compareTo(b.kind),
          'state' => a.state.compareTo(b.state),
          'latency' => (a.latencyMs ?? -1).compareTo(b.latencyMs ?? -1),
          _ => a.createdAt.compareTo(b.createdAt),
        };
        rows.sort((a, b) => asc ? cmp(a, b) : cmp(b, a));
        final sel = rows.where((m) => m.id == selected).firstOrNull;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _stat(context, 'Messages', Fmt.num(d?.summary.messages), LucideIcons.arrowUpDown),
                  _stat(context, 'Bytes', Fmt.bytes(d?.summary.bytes), LucideIcons.hardDrive),
                  _stat(context, 'Avg delivery', Fmt.duration(d?.summary.avgDeliveryMs), LucideIcons.timer),
                  _stat(context, 'Failed', Fmt.num(d?.summary.failed), LucideIcons.triangleAlert),
                  const Spacer(),
                  if (d != null) _breakdown(context, d.summary),
                ],
              ),
            ),
            const Divider(),
            Padding(
              padding: const EdgeInsets.all(10),
              child: Row(
                children: [
                  SizedBox(
                    width: 280,
                    child: TextField(
                      style: T.callout,
                      decoration: const InputDecoration(hintText: 'Search content or id…', prefixIcon: Icon(LucideIcons.search, size: 14)),
                      onChanged: (v) {
                        _debounce?.cancel();
                        _debounce = Timer(
                          const Duration(milliseconds: 250),
                          () => setState(() {
                            search = v;
                            page = 0;
                          }),
                        );
                      },
                    ),
                  ),
                  const SizedBox(width: 10),
                  Dropdown<String>(
                    value: kind,
                    options: const [
                      ('', 'All kinds'),
                      ('request', 'request'),
                      ('answer', 'answer'),
                      ('ask', 'ask'),
                      ('reply', 'reply'),
                      ('message', 'message'),
                      ('notice', 'notice'),
                    ],
                    onChanged: (v) => setState(() {
                      kind = v;
                      page = 0;
                    }),
                  ),
                  const SizedBox(width: 8),
                  Dropdown<String>(
                    value: state,
                    options: const [
                      ('', 'All states'),
                      ('pending', 'pending'),
                      ('deferred', 'deferred'),
                      ('sending', 'sending'),
                      ('delivered', 'delivered'),
                      ('answered', 'answered'),
                      ('failed', 'failed'),
                      ('cancelled', 'cancelled'),
                    ],
                    onChanged: (v) => setState(() {
                      state = v;
                      page = 0;
                    }),
                  ),
                  const Spacer(),
                  Btn(
                    'CSV…',
                    icon: LucideIcons.share,
                    onPressed: () => exportFile(context, '/api/export?what=messages&format=csv&range=${app.range.label}', 'blueaibridge-messages.csv'),
                  ),
                  const SizedBox(width: 8),
                  Btn(
                    'JSON…',
                    icon: LucideIcons.share,
                    onPressed: () => exportFile(context, '/api/export?what=messages&format=json&range=${app.range.label}', 'blueaibridge-messages.json'),
                  ),
                ],
              ),
            ),
            if (error != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 10),
                child: ErrorBanner(error, retry: reload),
              ),
            Expanded(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(child: _table(context, rows)),
                  if (sel != null)
                    Container(
                      width: 400,
                      decoration: BoxDecoration(
                        border: Border(left: BorderSide(color: t.separator)),
                      ),
                      child: _Inspector(message: sel),
                    ),
                ],
              ),
            ),
            const Divider(),
            Padding(
              padding: const EdgeInsets.all(8),
              child: Row(
                children: [
                  Text('AppPage ${page + 1}', style: T.caption.copyWith(color: t.text3)),
                  const Spacer(),
                  Btn('Previous', small: true, onPressed: page == 0 ? null : () => setState(() => page--)),
                  const SizedBox(width: 6),
                  Btn('Next', small: true, onPressed: rows.length < _pageSize ? null : () => setState(() => page++)),
                ],
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _stat(BuildContext context, String label, String value, IconData icon) => Padding(
    padding: const EdgeInsets.only(right: 28),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(icon, size: 12, color: context.t.text3),
            const SizedBox(width: 5),
            Text(label, style: T.caption.copyWith(color: context.t.text3)),
          ],
        ),
        const SizedBox(height: 2),
        Text(
          value,
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, fontFeatures: [FontFeature.tabularFigures()]),
        ),
      ],
    ),
  );

  Widget _breakdown(BuildContext context, Summary s) {
    final t = context.t;
    final total = s.byDirection.fold<int>(0, (a, d) => a + d.bytes).clamp(1, 1 << 62);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        for (final d in s.byDirection)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('${Fmt.appName(d.from == 'bridge' ? null : d.from)} → ${d.to == '?' ? 'pending' : Fmt.appName(d.to)}', style: T.caption),
                const SizedBox(width: 6),
                Container(
                  width: (120 * d.bytes / total).clamp(4, 120).toDouble(),
                  height: 6,
                  decoration: BoxDecoration(
                    color: d.from == 'claude'
                        ? t.claudeToGpt
                        : d.from == 'codex'
                        ? t.gptToClaude
                        : t.bridge,
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
                SizedBox(
                  width: 110,
                  child: Text(
                    '${Fmt.bytes(d.bytes)} · ${d.messages}',
                    style: T.caption.copyWith(color: t.text3),
                    textAlign: TextAlign.right,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _table(BuildContext context, List<Message> rows) {
    final t = context.t;
    if (rows.isEmpty) return const EmptyState(icon: LucideIcons.arrowUpDown, title: 'No messages in this range');
    Widget head(String label, String? col, double? w, {bool flex = false}) {
      final child = InkWell(
        onTap: col == null
            ? null
            : () => setState(() {
                if (sortCol == col) {
                  asc = !asc;
                } else {
                  sortCol = col;
                  asc = false;
                }
              }),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          child: Row(
            children: [
              Text(
                label,
                style: T.caption.copyWith(color: t.text3, fontWeight: FontWeight.w600),
              ),
              if (sortCol == col) Icon(asc ? LucideIcons.chevronUp : LucideIcons.chevronDown, size: 11, color: t.text3),
            ],
          ),
        ),
      );
      return flex ? Expanded(child: child) : SizedBox(width: w, child: child);
    }

    return Column(
      children: [
        Container(
          color: t.text.withValues(alpha: 0.03),
          child: Row(
            children: [
              head('Time', 'time', 100),
              head('Message', null, 120),
              head('Direction', null, 200),
              head('Kind', 'kind', 140),
              head('Channel', null, 80),
              head('State', 'state', 110),
              head('Size', 'size', 80),
              head('Latency', 'latency', 80),
              head('Preview', null, null, flex: true),
            ],
          ),
        ),
        const Divider(),
        Expanded(
          child: ListView.separated(
            itemCount: rows.length,
            separatorBuilder: (_, _) => const Divider(),
            itemBuilder: (_, i) {
              final m = rows[i];
              Widget cell(Widget c, double? w, {bool flex = false}) {
                final p = Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
                  child: Align(alignment: Alignment.centerLeft, child: c),
                );
                return flex ? Expanded(child: p) : SizedBox(width: w, child: p);
              }

              return InkWell(
                onTap: () => setState(() => selected = selected == m.id ? null : m.id),
                child: Container(
                  color: selected == m.id ? t.accent.withValues(alpha: 0.14) : null,
                  child: Row(
                    children: [
                      cell(
                        Tooltip(
                          message: Fmt.dateTime(m.createdAt),
                          child: Text(Fmt.ago(m.createdAt), style: T.caption.copyWith(color: t.text2)),
                        ),
                        100,
                      ),
                      cell(Text('${m.id}${m.linkId != null ? ' · ${m.linkId}' : ''}', style: T.mono.copyWith(fontSize: 11)), 120),
                      cell(
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            AppBadge(m.from),
                            Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 4),
                              child: Icon(LucideIcons.arrowRight, size: 10, color: t.text3),
                            ),
                            m.to != null ? AppBadge(m.to) : Pill('pending', color: t.warning),
                          ],
                        ),
                        200,
                      ),
                      cell(m.decision != null ? DecisionBadge(m.decision!.decision) : Text(m.kind, style: T.caption), 140),
                      cell(Text(m.channel ?? '—', style: T.caption.copyWith(color: t.text3)), 80),
                      cell(StateBadge(m.state), 110),
                      cell(Text(Fmt.bytes(m.bytes), style: T.caption), 80),
                      cell(Text(Fmt.duration(m.latencyMs), style: T.caption.copyWith(color: t.text3)), 80),
                      cell(
                        Text(
                          (m.decision?.note ?? m.body).replaceAll('\n', ' '),
                          style: T.caption.copyWith(color: t.text3),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        null,
                        flex: true,
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _Inspector extends StatelessWidget {
  final Message message;
  const _Inspector({required this.message});
  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final m = message;
    final app = context.read<AppState>();
    TableRow row(String k, Widget v) => TableRow(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Text(k, style: T.callout.copyWith(color: t.text3)),
        ),
        Padding(padding: const EdgeInsets.symmetric(vertical: 4), child: v),
      ],
    );
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(m.id, style: T.mono.copyWith(fontSize: 16, fontWeight: FontWeight.w600)),
              const SizedBox(width: 8),
              StateBadge(m.state),
              const Spacer(),
              if (m.linkId != null) Btn('Open conversation', small: true, onPressed: () => app.open(AppPage.conversations, link: m.linkId)),
            ],
          ),
          const SizedBox(height: 12),
          Table(
            columnWidths: const {0: IntrinsicColumnWidth(), 1: FlexColumnWidth()},
            children: [
              row('From     ', AppBadge(m.from, showId: true)),
              row('To', m.to != null ? AppBadge(m.to, showId: true) : const Text('—')),
              row('Kind', Text('${m.kind} · round ${m.round}', style: T.callout)),
              row('Channel', Text(m.channel ?? '—', style: T.callout)),
              row('Size', Text(Fmt.bytes(m.bytes), style: T.callout)),
              row('Created', Text(Fmt.dateTime(m.createdAt), style: T.callout)),
              row('Delivered', Text(m.deliveredAt == null ? '—' : '${Fmt.dateTime(m.deliveredAt)} (${Fmt.duration(m.latencyMs)})', style: T.callout)),
              row('Attempts', Text('${m.attempts}', style: T.callout)),
              if (m.error != null) row('Error', Text(m.error!, style: T.callout.copyWith(color: t.critical))),
            ],
          ),
          const SizedBox(height: 12),
          const Divider(),
          const SizedBox(height: 12),
          m.decision != null ? DecisionView(decision: m.decision!) : MarkdownText(m.body),
        ],
      ),
    );
  }
}
