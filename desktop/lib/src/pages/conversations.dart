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
import 'activity.dart';

/// One conversation in a list.
class LinkRow extends StatelessWidget {
  final Link link;
  final bool selected;
  const LinkRow({super.key, required this.link, this.selected = false});
  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final l = link;
    return Container(
      color: selected ? t.accent.withValues(alpha: 0.14) : null,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(l.id, style: T.mono.copyWith(fontSize: 11, color: t.text3)),
              const SizedBox(width: 6),
              Pill(Fmt.kindLabel(l.kind) + (l.reviewKind == 'plan' ? ' · plan' : ''), filled: false),
              const Spacer(),
              Text(Fmt.ago(l.updatedAt), style: T.caption.copyWith(color: t.text3)),
            ],
          ),
          const SizedBox(height: 5),
          Text(l.title.isEmpty ? '(untitled)' : l.title, style: T.calloutStrong, maxLines: 1, overflow: TextOverflow.ellipsis),
          const SizedBox(height: 6),
          Row(
            children: [
              AppBadge(l.requester),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 5),
                child: Icon(LucideIcons.arrowRight, size: 11, color: t.text3),
              ),
              l.reviewer != null ? AppBadge(l.reviewer) : Pill(l.joinCode != null ? 'code ${l.joinCode}' : 'pending', color: t.warning),
              const Spacer(),
              l.lastMessage?.decision != null ? DecisionBadge(l.lastMessage!.decision!.decision) : StateBadge(l.status),
            ],
          ),
        ],
      ),
    );
  }
}

class ConversationsPage extends StatefulWidget {
  const ConversationsPage({super.key});
  @override
  State<ConversationsPage> createState() => _ConversationsPageState();
}

class _ConversationsPageState extends State<ConversationsPage> {
  String status = 'all';
  String kind = '';
  String search = '';
  Timer? _debounce;
  final _searchCtl = TextEditingController();

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final t = context.t;
    final st = status == 'active'
        ? 'open,waiting_join,answered'
        : status == 'closed'
        ? 'closed'
        : '';
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          width: 370,
          decoration: BoxDecoration(
            border: Border(right: BorderSide(color: t.separator)),
          ),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(10),
                child: Column(
                  children: [
                    TextField(
                      controller: _searchCtl,
                      style: T.callout,
                      decoration: const InputDecoration(hintText: 'Search topic or link id (L12)…', prefixIcon: Icon(LucideIcons.search, size: 14)),
                      onChanged: (v) {
                        _debounce?.cancel();
                        _debounce = Timer(const Duration(milliseconds: 250), () => setState(() => search = v));
                      },
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Segmented<String>(
                          value: status,
                          options: const [('all', 'All'), ('active', 'Active'), ('closed', 'Closed')],
                          onChanged: (v) => setState(() => status = v),
                        ),
                        const Spacer(),
                        Dropdown<String>(
                          value: kind,
                          options: const [('', 'All kinds'), ('review', 'Reviews'), ('auto', 'Auto mode'), ('turn', 'Turn reviews'), ('ask', 'Questions')],
                          onChanged: (v) => setState(() => kind = v),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const Divider(),
              Expanded(
                child: Loader<List<Link>>(
                  reloadKey: '$st|$kind|$search',
                  load: () async {
                    final links = await app.broker.get(
                      '/api/links?limit=300&status=$st&kind=$kind&q=${Uri.encodeQueryComponent(search)}',
                      (j) => (j['links'] as List).map((e) => Link.fromJson(e)).toList(),
                    );
                    if (app.selectedLink == null && links.isNotEmpty) app.selectLink(links.first.id);
                    return links;
                  },
                  builder: (context, links, error, reload) {
                    if (error != null)
                      return Padding(
                        padding: const EdgeInsets.all(8),
                        child: ErrorBanner(error, retry: reload),
                      );
                    if (links == null) return const Center(child: CircularProgressIndicator(strokeWidth: 2));
                    if (links.isEmpty) {
                      return EmptyState(
                        icon: LucideIcons.messagesSquare,
                        title: 'No conversations',
                        message: search.isEmpty ? 'They appear here as soon as one chat asks the other.' : 'Nothing matches.',
                      );
                    }
                    return ListView.separated(
                      itemCount: links.length,
                      separatorBuilder: (_, _) => const Divider(),
                      itemBuilder: (_, i) => InkWell(
                        onTap: () => app.selectLink(links[i].id),
                        child: LinkRow(link: links[i], selected: app.selectedLink == links[i].id),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: app.selectedLink == null
              ? const EmptyState(icon: LucideIcons.messagesSquare, title: 'Select a conversation')
              : LinkDetailView(key: ValueKey(app.selectedLink), id: app.selectedLink!),
        ),
      ],
    );
  }
}

class LinkDetailView extends StatefulWidget {
  final String id;
  const LinkDetailView({super.key, required this.id});
  @override
  State<LinkDetailView> createState() => _LinkDetailViewState();
}

class _LinkDetailViewState extends State<LinkDetailView> {
  String tab = 'thread';
  final _scroll = ScrollController();
  int _lastCount = -1;

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final app = context.read<AppState>();
    return Loader<LinkDetail>(
      reloadKey: widget.id,
      load: () => app.broker.get('/api/links/${widget.id}', LinkDetail.fromJson),
      builder: (context, d, error, reload) {
        if (error != null && d == null)
          return Padding(
            padding: const EdgeInsets.all(12),
            child: ErrorBanner(error, retry: reload),
          );
        if (d == null) return const Center(child: CircularProgressIndicator(strokeWidth: 2));
        if (d.messages.length != _lastCount && tab == 'thread') {
          _lastCount = d.messages.length;
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent);
          });
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _header(context, d, reload),
            const Divider(),
            Padding(
              padding: const EdgeInsets.all(10),
              child: Center(
                child: Segmented<String>(
                  value: tab,
                  options: [('thread', 'Conversation'), ('events', 'Events (${d.events.length})'), ('details', 'Details')],
                  onChanged: (v) => setState(() {
                    tab = v;
                    _lastCount = -1;
                  }),
                ),
              ),
            ),
            const Divider(),
            Expanded(
              child: switch (tab) {
                'events' => ListView.separated(
                  itemCount: d.events.length,
                  separatorBuilder: (_, _) => const Divider(),
                  itemBuilder: (_, i) => EventRow(event: d.events[i]),
                ),
                'details' => SingleChildScrollView(padding: const EdgeInsets.all(20), child: _details(context, d)),
                _ => ListView.separated(
                  controller: _scroll,
                  padding: const EdgeInsets.all(20),
                  itemCount: d.messages.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 14),
                  itemBuilder: (_, i) => MessageBubble(message: d.messages[i], requesterKey: d.link.requester.key, reload: reload),
                ),
              },
            ),
          ],
        );
      },
    );
  }

  Widget _header(BuildContext context, LinkDetail d, VoidCallback reload) {
    final t = context.t;
    final app = context.read<AppState>();
    final l = d.link;
    final last = d.messages.lastWhere(
      (m) => m.decision != null,
      orElse: () => d.messages.isEmpty
          ? Message.fromJson(const {'id': '', 'kind': '', 'state': '', 'round': 0, 'bytes': 0, 'attempts': 0, 'createdAt': 0})
          : d.messages.last,
    );
    final totalBytes = d.messages.fold<int>(0, (a, m) => a + m.bytes);
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 6,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(l.id, style: T.mono.copyWith(color: t.text3)),
              Pill(Fmt.kindLabel(l.kind) + (l.reviewKind != null ? ' · ${l.reviewKind}' : ''), filled: false),
              StateBadge(l.status),
              DecisionBadge(last.decision?.decision),
              Pill('round ${l.round}'),
              Pill(l.delivery),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: SelectableText(l.title.isEmpty ? '(untitled)' : l.title, style: T.title3, maxLines: 2)),
              IconBtn(LucideIcons.rotateCw, tooltip: 'Refresh', onPressed: reload),
              if (l.status != 'closed') ...[
                const SizedBox(width: 6),
                Btn(
                  'Close link',
                  icon: LucideIcons.circleX,
                  destructive: true,
                  onPressed: () async {
                    if (!await confirm(
                      context,
                      title: 'Close ${l.id}?',
                      message: "Messages not handed over yet are cancelled, and a late answer is refused. The chats themselves aren't changed.",
                      button: 'Close link',
                      destructive: true,
                    )) {
                      return;
                    }
                    try {
                      await app.broker.post('/api/links/${l.id}/close');
                      app.notify('${l.id} closed');
                      reload();
                    } catch (e) {
                      app.notify("Couldn't close", e.toString(), true);
                    }
                  },
                ),
              ],
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              AppBadge(l.requester, showId: true),
              if (d.requester?.title != null)
                Padding(
                  padding: const EdgeInsets.only(left: 6),
                  child: Text('“${_cut(d.requester!.title!, 40)}”', style: T.caption.copyWith(color: t.text3)),
                ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 6),
                child: Text('asked', style: T.caption.copyWith(color: t.text3)),
              ),
              Icon(LucideIcons.arrowRight, size: 12, color: t.text3),
              const SizedBox(width: 6),
              l.reviewer != null
                  ? AppBadge(l.reviewer, showId: true)
                  : Pill(l.joinCode != null ? 'waiting for code ${l.joinCode}' : 'reviewer created on first delivery', color: t.warning),
              const Spacer(),
              Flexible(
                child: Text(
                  '${d.messages.length} messages · ${Fmt.bytes(totalBytes)} · started ${Fmt.dateTime(l.createdAt)}',
                  style: T.caption.copyWith(color: t.text3),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _details(BuildContext context, LinkDetail d) {
    final t = context.t;
    final app = context.read<AppState>();
    final l = d.link;
    TableRow row(String k, Widget v) => TableRow(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 5),
          child: Text(k, style: T.callout.copyWith(color: t.text3)),
        ),
        Padding(padding: const EdgeInsets.symmetric(vertical: 5), child: v),
      ],
    );
    Text txt(String s) => Text(s, style: T.callout);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Table(
          columnWidths: const {0: IntrinsicColumnWidth(), 1: FlexColumnWidth()},
          defaultVerticalAlignment: TableCellVerticalAlignment.top,
          children: [
            row('Link     ', txt(l.id)),
            row(
              'Kind',
              txt('${Fmt.kindLabel(l.kind)}${l.reviewKind != null ? ' (${l.reviewKind})' : ''}${l.ownInitiative ? " · agent's own initiative" : ''}'),
            ),
            row('Requester', txt('${l.requester.key}${d.requester != null ? ' · ${d.requester!.surface}' : ''}')),
            row('Reviewer', txt(l.reviewer == null ? '—' : '${l.reviewer!.key}${d.reviewer != null ? ' · ${d.reviewer!.surface}' : ''}')),
            row('Delivery', txt(l.delivery)),
            row(
              'Paths',
              l.paths.isEmpty
                  ? txt('—')
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        for (final p in l.paths)
                          Row(
                            children: [
                              Icon(LucideIcons.folder, size: 13, color: t.text3),
                              const SizedBox(width: 6),
                              Flexible(child: SelectableText(p, style: T.mono)),
                              if (l.fingerprints[p] != null) Text('  ${l.fingerprints[p]!.substring(0, 10)}', style: T.mono.copyWith(color: t.text3)),
                            ],
                          ),
                      ],
                    ),
            ),
            row('Created', txt(Fmt.dateTime(l.createdAt))),
            row('Updated', txt(Fmt.dateTime(l.updatedAt))),
            if (l.closedAt != null) row('Closed', txt('${Fmt.dateTime(l.closedAt)} — ${l.closeReason ?? ''}')),
          ],
        ),
        const SizedBox(height: 16),
        Wrap(
          spacing: 8,
          children: [
            Btn(
              "Requester's full chat",
              icon: LucideIcons.libraryBig,
              onPressed: () => app.open(AppPage.chats, chat: l.requester.key),
            ),
            if (l.reviewer != null)
              Btn(
                "Reviewer's full chat",
                icon: LucideIcons.libraryBig,
                onPressed: () => app.open(AppPage.chats, chat: l.reviewer!.key),
              ),
          ],
        ),
      ],
    );
  }
}

/// Shorten long text at a line boundary, so code spans and fences stay intact.
String clipAtLine(String s, int n) {
  if (s.length <= n) return s;
  final cut = s.lastIndexOf('\n', n);
  var out = s.substring(0, cut > n ~/ 2 ? cut : n);
  if ('```'.allMatches(out).length.isOdd) out += '\n```';
  return '$out\n…';
}

String _cut(String s, int n) => s.length > n ? '${s.substring(0, n)}…' : s;

class MessageBubble extends StatefulWidget {
  final Message message;
  final String requesterKey;
  final VoidCallback reload;
  const MessageBubble({super.key, required this.message, required this.requesterKey, required this.reload});
  @override
  State<MessageBubble> createState() => _MessageBubbleState();
}

class _MessageBubbleState extends State<MessageBubble> {
  bool expanded = false;

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final m = widget.message;
    if (m.from == null) {
      return Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: t.brand.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10)),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(LucideIcons.waypoints, size: 16, color: t.brand),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('BlueAIBridge notice · ${Fmt.time(m.createdAt)} → ${Fmt.appName(m.to?.app)}', style: T.caption.copyWith(color: t.text3)),
                  const SizedBox(height: 3),
                  SelectableText(m.body, style: T.callout),
                ],
              ),
            ),
            StateBadge(m.state),
          ],
        ),
      );
    }
    final right = m.from!.key != widget.requesterKey;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (right) const SizedBox(width: 60) else Avatar(m.from!.app),
        const SizedBox(width: 10),
        Expanded(
          child: Align(
            alignment: right ? Alignment.topRight : Alignment.topLeft,
            child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 900), child: _bubble(context)),
          ),
        ),
        const SizedBox(width: 10),
        if (right) Avatar(m.from!.app) else const SizedBox(width: 60),
      ],
    );
  }

  Widget _bubble(BuildContext context) {
    final t = context.t;
    final m = widget.message;
    final app = context.read<AppState>();
    final label = const {'request': 'asked for a review', 'answer': 'answered', 'ask': 'asked', 'reply': 'replied', 'message': 'wrote'}[m.kind] ?? m.kind;
    final long = m.kind == 'request' && m.body.length > 1200 && !expanded;
    final problem = m.state == 'failed'
        ? m.error
        : const ['deferred', 'pending', 'sending'].contains(m.state)
        ? (m.deferReason ?? m.error)
        : null;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: t.card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: t.cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 6,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(Fmt.appName(m.from?.app), style: T.calloutStrong),
              Text(label, style: T.caption.copyWith(color: t.text3)),
              Text(m.id, style: T.mono.copyWith(fontSize: 11, color: t.text3)),
              if (m.round > 1) Text('round ${m.round}', style: T.caption.copyWith(color: t.text3)),
              Text('· ${Fmt.time(m.createdAt)}', style: T.caption.copyWith(color: t.text3)),
              const SizedBox(width: 12),
              StateBadge(m.state),
              if (m.channel != null) Pill(m.channel!, filled: false),
              Text(Fmt.bytes(m.bytes), style: T.caption.copyWith(color: t.text3)),
              if (m.latencyMs != null)
                Tooltip(
                  message: 'Delivery latency',
                  child: Text(Fmt.duration(m.latencyMs), style: T.caption.copyWith(color: t.text3)),
                ),
              IconBtn(LucideIcons.copy, tooltip: 'Copy', size: 13, onPressed: () => copyText(context, _copyText(m))),
            ],
          ),
          const SizedBox(height: 10),
          if (m.decision != null)
            DecisionView(decision: m.decision!)
          else ...[
            MarkdownText(long ? clipAtLine(m.body, 1200) : m.body),
            if (long)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: LinkText('Show full request (${Fmt.bytes(m.bytes)})', onTap: () => setState(() => expanded = true)),
              ),
          ],
          if (problem != null) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: (m.state == 'failed' ? t.critical : t.warning).withValues(alpha: 0.1), borderRadius: BorderRadius.circular(8)),
              child: Row(
                children: [
                  Icon(LucideIcons.triangleAlert, size: 14, color: m.state == 'failed' ? t.critical : t.warning),
                  const SizedBox(width: 8),
                  Expanded(child: Text(problem, style: T.caption)),
                  if (m.state == 'failed' || m.state == 'deferred')
                    Btn(
                      'Retry now',
                      icon: LucideIcons.rotateCw,
                      small: true,
                      onPressed: () async {
                        try {
                          await app.broker.post('/api/messages/${m.id}/retry');
                          app.notify('Retrying ${m.id}');
                          widget.reload();
                        } catch (e) {
                          app.notify('Retry failed', e.toString(), true);
                        }
                      },
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  String _copyText(Message m) {
    final d = m.decision;
    if (d == null) return m.body;
    return [
      d.approved ? '[APPROVED]' : '[CHANGES REQUESTED]',
      '',
      d.note,
      if (d.blocking.isNotEmpty) ...['', 'Must fix:', ...d.blocking.map((b) => '- $b')],
      if (d.nits.isNotEmpty) ...['', 'Nits:', ...d.nits.map((b) => '- $b')],
    ].join('\n');
  }
}

class DecisionView extends StatelessWidget {
  final Decision decision;
  const DecisionView({super.key, required this.decision});
  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final c = decision.approved ? t.good : t.warning;
    Widget list(String title, List<String> items) => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: T.caption2.copyWith(color: t.text3, fontWeight: FontWeight.w700, letterSpacing: 0.4),
        ),
        const SizedBox(height: 4),
        for (final i in items)
          Padding(
            padding: const EdgeInsets.only(bottom: 3),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('•  '),
                Expanded(child: MarkdownText(i)),
              ],
            ),
          ),
      ],
    );
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.09),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: c.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(decision.approved ? LucideIcons.badgeCheck : LucideIcons.triangleAlert, size: 16, color: c),
              const SizedBox(width: 8),
              Text(decision.approved ? 'Approved' : 'Changes requested', style: T.calloutStrong.copyWith(color: c)),
            ],
          ),
          const SizedBox(height: 8),
          MarkdownText(decision.note),
          if (decision.blocking.isNotEmpty) ...[const SizedBox(height: 8), list('MUST FIX', decision.blocking)],
          if (decision.nits.isNotEmpty) ...[const SizedBox(height: 8), list('NITS', decision.nits)],
        ],
      ),
    );
  }
}
