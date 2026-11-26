import 'dart:io';

import 'package:file_selector/file_selector.dart';
import 'package:material_ui/material_ui.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/app_state.dart';
import '../theme/tokens.dart';
import '../util/format.dart';
import '../widgets/components.dart';

String _who(String? key) => Fmt.appName(key?.split(':').first);

(IconData, Color, String) describe(BuildContext context, BridgeEvent e) {
  final t = context.t;
  final d = e.data;
  String s(String k) => d[k]?.toString() ?? '';
  String cut(String v, int n) => v.length > n ? '${v.substring(0, n)}…' : v;
  switch (e.type) {
    case 'message.created':
      return (LucideIcons.messageSquare, t.text2, '${_who(e.actor)} → ${_who(d['to'] as String?)}: new ${s('kind')} ${e.messageId ?? ''}');
    case 'review.answered':
      if (d['decision'] == 'approved') return (LucideIcons.badgeCheck, t.good, '${_who(e.actor)} approved ${e.linkId ?? ''} (round ${s('round')})');
      if (d['decision'] == 'changes_requested')
        return (LucideIcons.triangleAlert, t.warning, '${_who(e.actor)} requested changes on ${e.linkId ?? ''}: ${s('blocking')} must-fix');
      return (LucideIcons.messageSquare, t.text2, '${_who(e.actor)} answered ${e.linkId ?? ''}');
    case 'ask.answered':
      return (LucideIcons.messageCircle, t.text2, '${_who(e.actor)} answered a question (${e.linkId ?? ''})');
    case 'delivery.started':
      return (LucideIcons.circleArrowUp, t.brand, 'Sending ${e.messageId ?? ''} to ${_who(e.actor)} (${s('channel')})');
    case 'delivery.done':
      return (LucideIcons.circleCheck, t.good, 'Delivered ${e.messageId ?? ''} to ${_who(e.actor)} (${s('channel')})');
    case 'delivery.deferred':
      return (LucideIcons.clock, t.warning, '${e.messageId ?? ''} waits: ${s('reason')}');
    case 'delivery.retry':
      return (LucideIcons.rotateCw, t.warning, 'Retrying ${e.messageId ?? ''} (attempt ${s('attempts')}): ${cut(s('error'), 120)}');
    case 'delivery.failed':
      return (LucideIcons.octagonX, t.critical, 'Delivery of ${e.messageId ?? ''} failed: ${cut(s('error'), 160)}');
    case 'link.created':
      return (
        LucideIcons.link,
        t.brand,
        '${_who(e.actor)} opened ${e.linkId ?? ''} (${s('kind')}, ${s('delivery')})${d['title'] != null ? ': ${cut(s('title'), 80)}' : ''}',
      );
    case 'link.joined':
      return (LucideIcons.userPlus, t.brand, '${_who(e.actor)} joined ${e.linkId ?? ''} with a code');
    case 'link.closed':
      return (LucideIcons.unlink, t.text3, '${e.linkId ?? ''} closed: ${s('reason')}');
    case 'auto.on':
      return (LucideIcons.zap, t.brand, '${_who(e.actor)} turned auto mode on (${d['everyTurn'] == true ? 'every turn' : 'key moments'})');
    case 'auto.off':
      return (LucideIcons.zapOff, t.text3, '${_who(e.actor)} turned auto mode off');
    case 'auto.guard':
      return (LucideIcons.hand, t.warning, 'End-of-turn check stopped ${_who(e.actor)}: unapproved changes');
    case 'client.seen':
      return (LucideIcons.userPlus, t.text3, 'New chat: ${_who(e.actor)} (${s('surface')})');
    case 'client.stop_failure':
      return (LucideIcons.octagonX, t.critical, '${_who(e.actor)} stopped with an API error');
    case 'client.permission_prompt':
      return (LucideIcons.hand, t.warning, '${_who(e.actor)} waits for a tool approval');
    case 'broker.started':
      return (LucideIcons.power, t.good, 'Broker started (pid ${s('pid')}, v${s('version')})');
    case 'broker.error':
      return (LucideIcons.octagonAlert, t.critical, 'Broker error in ${s('what')}: ${cut(s('error'), 160)}');
    case 'install.install':
      return (LucideIcons.download, t.text2, 'Installed ${s('target')}');
    case 'install.uninstall':
      return (LucideIcons.trash2, t.text2, 'Uninstalled ${s('target')}');
    default:
      return (LucideIcons.circle, t.text3, '${e.type}${e.linkId != null ? ' · ${e.linkId}' : ''}${e.messageId != null ? ' · ${e.messageId}' : ''}');
  }
}

class EventRow extends StatelessWidget {
  final BridgeEvent event;
  final bool compact;
  const EventRow({super.key, required this.event, this.compact = false});
  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final (icon, color, text) = describe(context, event);
    return Padding(
      padding: EdgeInsets.symmetric(horizontal: 14, vertical: compact ? 6 : 8),
      child: Row(
        children: [
          SizedBox(
            width: compact ? 62 : 74,
            child: Text(
              Fmt.time(event.ts),
              style: T.caption.copyWith(color: t.text3, fontFeatures: const [FontFeature.tabularFigures()]),
            ),
          ),
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 10),
          Expanded(
            child: Text(text, style: compact ? T.caption : T.callout, maxLines: compact ? 1 : 2, overflow: TextOverflow.ellipsis),
          ),
          if (!compact) ...[
            if (event.bytes > 0) Text(Fmt.bytes(event.bytes), style: T.caption.copyWith(color: t.text3)),
            if (event.linkId != null) ...[
              const SizedBox(width: 10),
              LinkText('Open ${event.linkId}', onTap: () => context.read<AppState>().open(AppPage.conversations, link: event.linkId)),
            ],
          ],
        ],
      ),
    );
  }
}

final _filters = <(String, String, bool Function(String))>[
  ('all', 'All', (_) => true),
  ('messages', 'Messages', (t) => t.startsWith('message.') || t.startsWith('review.') || t.startsWith('ask.')),
  ('delivery', 'Delivery', (t) => t.startsWith('delivery.') || t.startsWith('app.')),
  ('links', 'Links', (t) => t.startsWith('link.') || t.startsWith('auto.')),
  ('errors', 'Errors', (t) => t.contains('failed') || t.contains('error') || t.contains('retry') || t.contains('stop_failure')),
  ('system', 'System', (t) => ['broker.', 'install.', 'client.', 'rules.', 'config.', 'maintenance.', 'chat.'].any(t.startsWith)),
];

class ActivityPage extends StatefulWidget {
  const ActivityPage({super.key});
  @override
  State<ActivityPage> createState() => _ActivityPageState();
}

class _ActivityPageState extends State<ActivityPage> {
  String filter = 'all';
  List<BridgeEvent>? frozen;

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final source = frozen ?? app.events;
    final match = _filters.firstWhere((f) => f.$1 == filter).$3;
    final shown = source.where((e) => match(e.type)).toList();
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Segmented<String>(value: filter, options: [for (final f in _filters) (f.$1, f.$2)], onChanged: (v) => setState(() => filter = v)),
              const Spacer(),
              Text('${shown.length} events', style: T.caption.copyWith(color: context.t.text3)),
              const SizedBox(width: 10),
              Btn(
                frozen == null ? 'Pause' : 'Resume',
                icon: frozen == null ? LucideIcons.pause : LucideIcons.play,
                onPressed: () => setState(() => frozen = frozen == null ? List.of(app.events) : null),
              ),
              const SizedBox(width: 8),
              Btn(
                'Export…',
                icon: LucideIcons.share,
                onPressed: () => exportFile(context, '/api/export?what=events&format=csv&range=7d', 'blueaibridge-events.csv'),
              ),
            ],
          ),
        ),
        const Divider(),
        Expanded(
          child: shown.isEmpty
              ? const EmptyState(icon: LucideIcons.activity, title: 'No events yet', message: 'Events appear here live as chats use the bridge.')
              : ListView.separated(
                  itemCount: shown.length,
                  separatorBuilder: (_, _) => const Divider(),
                  itemBuilder: (_, i) => EventRow(event: shown[i]),
                ),
        ),
      ],
    );
  }
}

/// Save an export from the broker with the platform's save dialog.
Future<void> exportFile(BuildContext context, String path, String name) async {
  final app = context.read<AppState>();
  final loc = await getSaveLocation(suggestedName: name);
  if (loc == null) return;
  try {
    final bytes = await app.broker.raw(path);
    await File(loc.path).writeAsBytes(bytes);
    app.notify('Exported', loc.path.split(Platform.pathSeparator).last);
  } catch (e) {
    app.notify('Export failed', e.toString(), true);
  }
}
