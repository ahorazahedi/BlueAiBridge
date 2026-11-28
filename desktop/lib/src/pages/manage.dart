import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/app_state.dart';
import '../theme/tokens.dart';
import '../util/format.dart';
import '../widgets/components.dart';
import '../widgets/loader.dart';
import '../widgets/markdown.dart';

// =================================================================== chats

class ChatsPage extends StatefulWidget {
  const ChatsPage({super.key});
  @override
  State<ChatsPage> createState() => _ChatsPageState();
}

class _ChatsPageState extends State<ChatsPage> {
  String appFilter = '';
  String search = '';
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
    final sel = app.selectedChat;
    final i = sel?.indexOf(':') ?? -1;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          width: 360,
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
                      style: T.callout,
                      decoration: const InputDecoration(hintText: 'Find a chat by name or id…', prefixIcon: Icon(LucideIcons.search, size: 14)),
                      onChanged: (v) {
                        _debounce?.cancel();
                        _debounce = Timer(const Duration(milliseconds: 300), () => setState(() => search = v));
                      },
                    ),
                    const SizedBox(height: 8),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Segmented<String>(
                        value: appFilter,
                        options: const [('', 'Both apps'), ('claude', 'Claude'), ('codex', 'ChatGPT')],
                        onChanged: (v) => setState(() => appFilter = v),
                      ),
                    ),
                  ],
                ),
              ),
              const Divider(),
              Expanded(
                child: Loader<List<ChatSummary>>(
                  live: false,
                  reloadKey: '$appFilter|$search',
                  load: () => app.broker.get(
                    '/api/chats?limit=200&app=$appFilter&q=${Uri.encodeQueryComponent(search)}',
                    (j) => (j['chats'] as List).map((e) => ChatSummary.fromJson(e)).toList(),
                    timeout: const Duration(seconds: 60),
                  ),
                  builder: (context, chats, error, reload) {
                    if (error != null)
                      return Padding(
                        padding: const EdgeInsets.all(8),
                        child: ErrorBanner(error, retry: reload),
                      );
                    if (chats == null) return const Center(child: CircularProgressIndicator(strokeWidth: 2));
                    if (chats.isEmpty) return const EmptyState(icon: LucideIcons.libraryBig, title: 'No chats found');
                    return ListView.separated(
                      itemCount: chats.length,
                      separatorBuilder: (_, _) => const Divider(),
                      itemBuilder: (_, i) {
                        final c = chats[i];
                        return InkWell(
                          onTap: () => app.selectChat(c.key),
                          child: Container(
                            color: sel == c.key ? t.accent.withValues(alpha: 0.14) : null,
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Pill(c.app == 'claude' ? 'Claude' : 'ChatGPT', color: t.app(c.app)),
                                    const Spacer(),
                                    Text('${Fmt.ago(c.updatedAt)} · ${Fmt.bytes(c.size)}', style: T.caption.copyWith(color: t.text3)),
                                  ],
                                ),
                                const SizedBox(height: 4),
                                Text(c.title, style: T.calloutStrong, maxLines: 2, overflow: TextOverflow.ellipsis),
                                if (c.cwd != null)
                                  Text(
                                    c.cwd!,
                                    style: T.mono.copyWith(fontSize: 10.5, color: t.text3),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                              ],
                            ),
                          ),
                        );
                      },
                    );
                  },
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: i <= 0
              ? const EmptyState(
                  icon: LucideIcons.libraryBig,
                  title: 'Read any local chat',
                  message: 'Every Claude Code session and ChatGPT/Codex thread on this computer, read-only.',
                )
              : ChatReader(key: ValueKey(sel), app: sel!.substring(0, i), id: sel.substring(i + 1)),
        ),
      ],
    );
  }
}

class ChatReader extends StatefulWidget {
  final String app, id;
  const ChatReader({super.key, required this.app, required this.id});
  @override
  State<ChatReader> createState() => _ChatReaderState();
}

class _ChatReaderState extends State<ChatReader> {
  final pages = <ChatPage>[];
  bool tools = false, loading = false;
  Object? error;

  @override
  void initState() {
    super.initState();
    _load(null);
  }

  Future<void> _load(String? cursor) async {
    setState(() => loading = true);
    try {
      final p = await context.read<AppState>().broker.get(
        '/api/chats/${widget.app}/${Uri.encodeComponent(widget.id)}?${cursor != null ? 'cursor=$cursor&' : ''}${tools ? 'tools=1' : ''}',
        ChatPage.fromJson,
        timeout: const Duration(seconds: 60),
      );
      if (!mounted) return;
      setState(() {
        if (cursor != null) {
          pages.insert(0, p);
        } else {
          pages
            ..clear()
            ..add(p);
        }
        error = null;
      });
    } catch (e) {
      if (mounted) setState(() => error = e);
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final head = pages.isEmpty ? null : pages.last;
    final messages = pages.expand((p) => p.messages).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Pill(widget.app == 'claude' ? 'Claude Code session' : 'ChatGPT thread', color: t.app(widget.app)),
                  const SizedBox(width: 8),
                  Expanded(
                    child: SelectableText(widget.id, style: T.mono.copyWith(fontSize: 11, color: t.text3)),
                  ),
                  Checkbox(
                    value: tools,
                    visualDensity: VisualDensity.compact,
                    onChanged: (v) {
                      tools = v ?? false;
                      _load(null);
                    },
                  ),
                  const Text('Show tool steps', style: T.callout),
                ],
              ),
              const SizedBox(height: 4),
              Text(head?.title ?? ' ', style: T.title3),
              if (head?.cwd != null)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Row(
                    children: [
                      Icon(LucideIcons.folder, size: 12, color: t.text3),
                      const SizedBox(width: 6),
                      Text('${head!.cwd} · ${head.total} messages', style: T.caption.copyWith(color: t.text3)),
                    ],
                  ),
                ),
              for (final n in head?.notes ?? const <String>[]) Text(n, style: T.caption.copyWith(color: t.text3)),
            ],
          ),
        ),
        const Divider(),
        if (error != null)
          Padding(
            padding: const EdgeInsets.all(10),
            child: ErrorBanner(error!, retry: () => _load(null)),
          ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              if (pages.isNotEmpty && pages.first.nextCursor != null)
                Center(
                  child: Btn(
                    'Load older messages (${pages.first.start} more)',
                    icon: LucideIcons.arrowUp,
                    onPressed: loading ? null : () => _load(pages.first.nextCursor),
                  ),
                ),
              if (loading && pages.isEmpty) const Center(child: CircularProgressIndicator(strokeWidth: 2)),
              for (final m in messages)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: m.role == 'tool'
                      ? Padding(
                          padding: const EdgeInsets.only(left: 46),
                          child: Row(
                            children: [
                              Icon(LucideIcons.terminal, size: 12, color: t.text3),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(m.text, style: T.mono.copyWith(fontSize: 11, color: t.text3)),
                              ),
                            ],
                          ),
                        )
                      : _bubble(context, m),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _bubble(BuildContext context, ChatMessage m) {
    final t = context.t;
    final user = m.role == 'user';
    final bridgeMsg = m.text.startsWith('CLAUDE:') || m.text.startsWith('CHATGPT:');
    final bubble = Container(
      constraints: const BoxConstraints(maxWidth: 860),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: user ? t.brand.withValues(alpha: 0.08) : t.card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: t.cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 8,
            children: [
              Text(user ? (bridgeMsg ? 'Bridge message' : 'User') : Fmt.appName(widget.app), style: T.calloutStrong),
              if (m.ts != null) Text(Fmt.dateTime(m.ts), style: T.caption.copyWith(color: t.text3)),
              if (m.cut) Pill('cut at 25k chars', color: t.warning),
            ],
          ),
          const SizedBox(height: 6),
          MarkdownText(m.text),
        ],
      ),
    );
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (user) const SizedBox(width: 60) else Avatar(widget.app),
        const SizedBox(width: 10),
        Expanded(
          child: Align(alignment: user ? Alignment.topRight : Alignment.topLeft, child: bubble),
        ),
        const SizedBox(width: 10),
        if (user) const Avatar('user') else const SizedBox(width: 60),
      ],
    );
  }
}

// =================================================================== clients & install

class _ClientsData {
  final InstallStatus status;
  final List<ClientInfo> clients;
  _ClientsData(this.status, this.clients);
}

const _targetDesc = {
  'claude': "MCP server (user scope), 7 hooks and the tool permission, for Claude Desktop's Code tab and the Claude Code CLI.",
  'codex': 'MCP server in ~/.codex/config.toml and 3 hooks in ~/.codex/hooks.json, for ChatGPT Desktop and the Codex CLI.',
  'service': 'Keeps the broker running in the background and restarts it if it stops.',
  'menubar': 'The native macOS app: window plus menu-bar icon. Starts at login.',
  'desktop': 'This app: window plus tray icon. Starts at login.',
};

class ClientsPage extends StatefulWidget {
  const ClientsPage({super.key});
  @override
  State<ClientsPage> createState() => _ClientsPageState();
}

class _ClientsPageState extends State<ClientsPage> {
  String? busy;
  InstallResult? result;

  Future<void> _run(String action, String target, String label) async {
    final app = context.read<AppState>();
    final msg = action == 'uninstall'
        ? "This removes BlueAIBridge from ${target == 'all' ? 'every app, the background service and the desktop app' : target}. Every changed file is backed up first to ~/.blueaibridge/backups; your history stays.${target == 'all' || target == 'service' ? ' This window loses its connection once the background service stops.' : ''}"
        : "This changes your app configuration for ${target == 'all' ? 'Claude Code, ChatGPT/Codex, the background service and the desktop app' : target}. Every file is backed up first. Restart Claude Desktop and ChatGPT Desktop afterwards; ChatGPT asks you to trust the new hooks once.";
    if (!await confirm(context, title: '$label?', message: msg, button: label, destructive: action == 'uninstall')) return;
    setState(() => busy = '${action == 'install' ? 'Installing' : 'Uninstalling'} $target…');
    try {
      final r = InstallResult.fromJson(await app.broker.post('/api/install', {'target': target, 'action': action}));
      setState(() => result = r);
      app.notify(
        r.ok ? '$label done' : '$label finished with problems',
        r.ok && action == 'install' ? 'Restart Claude Desktop and ChatGPT Desktop to load it.' : null,
        !r.ok,
      );
      app.reload();
    } catch (e) {
      app.notify('$label failed', e.toString(), true);
    } finally {
      if (mounted) setState(() => busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = context.read<AppState>();
    final t = context.t;
    return Loader<_ClientsData>(
      load: () async {
        final s = app.broker.get('/api/install', InstallStatus.fromJson);
        final c = app.broker.get('/api/clients', (j) => (j['clients'] as List).map((e) => ClientInfo.fromJson(e)).toList());
        await Future.wait([s, c]); // so a failure of one isn't left unhandled while awaiting another
        return _ClientsData(await s, await c);
      },
      builder: (context, d, error, reload) => PageScroll(
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Install BlueAIBridge into each app, see what is detected on this computer, and every chat that has used the bridge.',
                  style: T.body.copyWith(color: t.text2),
                ),
              ),
              if (busy != null) ...[
                const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)),
                const SizedBox(width: 8),
                Text(busy!, style: T.caption),
                const SizedBox(width: 12),
              ],
              Btn(
                'Uninstall all',
                icon: LucideIcons.trash2,
                destructive: true,
                onPressed: busy != null ? null : () => _run('uninstall', 'all', 'Uninstall everything'),
              ),
              const SizedBox(width: 8),
              Btn(
                'Install all',
                icon: LucideIcons.download,
                primary: true,
                onPressed: busy != null ? null : () => _run('install', 'all', 'Install everything'),
              ),
            ],
          ),
          if (error != null) ErrorBanner(error, retry: reload),
          if (d != null) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: (d.status.runtimeInstalled && d.status.runtimeUpToDate ? t.good : t.warning).withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                children: [
                  Icon(
                    d.status.runtimeInstalled && d.status.runtimeUpToDate ? LucideIcons.badgeCheck : LucideIcons.triangleAlert,
                    size: 16,
                    color: d.status.runtimeInstalled && d.status.runtimeUpToDate ? t.good : t.warning,
                  ),
                  const SizedBox(width: 8),
                  Text('Runtime ${d.status.runtimeInstalled ? 'v${d.status.runtimeVersion}' : 'not installed'}', style: T.calloutStrong),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      d.status.runtimePath,
                      style: T.mono.copyWith(fontSize: 11, color: t.text3),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Btn(
                    d.status.runtimeInstalled ? 'Reinstall' : 'Install',
                    onPressed: busy != null ? null : () => _run('install', 'runtime', 'Update the runtime'),
                  ),
                ],
              ),
            ),
            LayoutBuilder(
              builder: (context, c) {
                final cols = c.maxWidth > 900 ? 2 : 1;
                final w = (c.maxWidth - 16 * (cols - 1)) / cols;
                return Wrap(
                  spacing: 16,
                  runSpacing: 16,
                  children: [for (final target in d.status.targets) SizedBox(width: w, child: _targetCard(context, target))],
                );
              },
            ),
            if (result != null)
              AppCard(
                title: 'Last ${result!.action}',
                subtitle: result!.backupDir != null ? 'Backups: ${result!.backupDir}' : null,
                trailing: LinkText('Dismiss', onTap: () => setState(() => result = null)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final s in result!.steps)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(s.ok ? LucideIcons.circleCheck : LucideIcons.octagonX, size: 15, color: s.ok ? t.good : t.critical),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text.rich(
                                TextSpan(
                                  children: [
                                    TextSpan(
                                      text: s.target,
                                      style: const TextStyle(fontWeight: FontWeight.w600),
                                    ),
                                    TextSpan(text: ' — ${s.message}'),
                                  ],
                                ),
                                style: T.callout,
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            AppCard(
              title: 'Chats seen by the bridge',
              subtitle: 'Every Claude session and ChatGPT thread that used BlueAIBridge',
              padded: false,
              child: d.clients.isEmpty
                  ? const SizedBox(
                      height: 180,
                      child: EmptyState(icon: LucideIcons.users, title: 'No chats yet', message: 'Chats show up the first time they use a BlueAIBridge tool.'),
                    )
                  : Column(
                      children: [
                        for (final cl in d.clients) ...[
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                            child: Row(
                              children: [
                                SizedBox(
                                  width: 300,
                                  child: Row(
                                    children: [
                                      AppBadge(cl.endpoint, showId: true),
                                      if (cl.title != null) ...[
                                        const SizedBox(width: 6),
                                        Flexible(
                                          child: Text(cl.title!, style: T.caption, overflow: TextOverflow.ellipsis),
                                        ),
                                      ],
                                    ],
                                  ),
                                ),
                                SizedBox(
                                  width: 90,
                                  child: Align(alignment: Alignment.centerLeft, child: Pill(cl.surface, filled: false)),
                                ),
                                Expanded(
                                  child: Text(cl.cwd ?? '—', style: T.mono.copyWith(fontSize: 11), overflow: TextOverflow.ellipsis),
                                ),
                                SizedBox(
                                  width: 100,
                                  child: cl.listening == null
                                      ? Text('n/a', style: T.caption.copyWith(color: t.text3))
                                      : Pill(
                                          cl.listening! ? 'listening' : 'not open',
                                          icon: cl.listening! ? LucideIcons.radio : null,
                                          color: cl.listening! ? t.good : t.text3,
                                        ),
                                ),
                                SizedBox(
                                  width: 100,
                                  child: Text(Fmt.ago(cl.lastSeen), style: T.caption.copyWith(color: t.text3)),
                                ),
                                LinkText('Read chat', onTap: () => app.open(AppPage.chats, chat: cl.endpoint.key)),
                              ],
                            ),
                          ),
                          const Divider(),
                        ],
                      ],
                    ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _targetCard(BuildContext context, InstallTarget target) {
    final t = context.t;
    final color = switch (target.id) {
      'claude' => t.claude,
      'codex' => t.gpt,
      'service' => t.brand,
      _ => const Color(0xFF64748B),
    };
    final icon = switch (target.id) {
      'claude' => LucideIcons.asterisk,
      'codex' => LucideIcons.hexagon,
      'service' => LucideIcons.zap,
      _ => LucideIcons.appWindow,
    };
    final details = target.details.entries.where((e) => !['plist', 'app'].contains(e.key)).toList()..sort((a, b) => a.key.compareTo(b.key));
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: t.card,
        borderRadius: BorderRadius.circular(radiusCard),
        border: Border.all(color: t.cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(10)),
                child: Icon(icon, color: Colors.white, size: 19),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(target.name, style: T.headline),
                        const SizedBox(width: 8),
                        target.installed
                            ? Pill('Installed', icon: LucideIcons.check, color: t.good)
                            : target.partial
                            ? Pill('Partly installed', icon: LucideIcons.triangleAlert, color: t.warning)
                            : const Pill('Not installed'),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(_targetDesc[target.id] ?? '', style: T.caption.copyWith(color: t.text3)),
                  ],
                ),
              ),
            ],
          ),
          for (final c in target.clients) ...[
            const SizedBox(height: 8),
            Tooltip(
              message: c.path ?? '',
              child: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: t.text.withValues(alpha: 0.04), borderRadius: BorderRadius.circular(7)),
                child: Row(
                  children: [
                    Container(
                      width: 7,
                      height: 7,
                      decoration: BoxDecoration(shape: BoxShape.circle, color: c.detected ? t.good : t.text3.withValues(alpha: 0.5)),
                    ),
                    const SizedBox(width: 8),
                    Expanded(child: Text(c.name, style: T.callout)),
                    Text(c.detected ? 'detected' : 'not found on this computer', style: T.caption.copyWith(color: t.text3)),
                  ],
                ),
              ),
            ),
          ],
          if (details.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [for (final e in details) Pill('${e.key}: ${e.value}', filled: false, color: e.value == false ? t.warning : null)],
            ),
          ],
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              if (target.installed || target.partial) ...[
                Btn(
                  'Uninstall',
                  icon: LucideIcons.trash2,
                  destructive: true,
                  onPressed: busy != null ? null : () => _run('uninstall', target.id, 'Uninstall ${target.name}'),
                ),
                const SizedBox(width: 8),
              ],
              Btn(
                target.installed ? 'Reinstall' : 'Install',
                icon: LucideIcons.download,
                primary: true,
                onPressed: busy != null ? null : () => _run('install', target.id, '${target.installed ? 'Reinstall' : 'Install'} ${target.name}'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// =================================================================== health

class HealthPage extends StatelessWidget {
  const HealthPage({super.key});
  @override
  Widget build(BuildContext context) {
    final app = context.read<AppState>();
    final t = context.t;
    return Loader<DoctorResult>(
      live: false,
      load: () => app.broker.get('/api/doctor', DoctorResult.fromJson, timeout: const Duration(seconds: 90)),
      builder: (context, d, error, reload) {
        final groups = <String, List<Check>>{};
        for (final c in d?.checks ?? const <Check>[]) {
          groups.putIfAbsent(c.group, () => []).add(c);
        }
        Color col(String s) => s == 'ok'
            ? t.good
            : s == 'warn'
            ? t.warning
            : t.critical;
        IconData ic(String s) => s == 'ok'
            ? LucideIcons.circleCheck
            : s == 'warn'
            ? LucideIcons.triangleAlert
            : LucideIcons.octagonX;
        return PageScroll(
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Every piece BlueAIBridge relies on, checked live, with a fix for each problem. Nothing is changed by a check.',
                    style: T.body.copyWith(color: t.text2),
                  ),
                ),
                Btn('Run checks again', icon: LucideIcons.rotateCw, onPressed: reload),
              ],
            ),
            if (error != null) ErrorBanner(error, retry: reload),
            LayoutBuilder(
              builder: (context, c) {
                final w = (c.maxWidth - 36) / 4;
                return Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: [
                    SizedBox(
                      width: w,
                      child: Kpi(
                        label: 'Overall',
                        value: d == null
                            ? 'Checking…'
                            : d.ok
                            ? 'Healthy'
                            : 'Needs attention',
                        icon: LucideIcons.stethoscope,
                        valueColor: d == null
                            ? null
                            : d.ok
                            ? t.good
                            : t.critical,
                      ),
                    ),
                    SizedBox(
                      width: w,
                      child: Kpi(label: 'Passing', value: '${d?.summary['ok'] ?? 0}', icon: LucideIcons.circleCheck),
                    ),
                    SizedBox(
                      width: w,
                      child: Kpi(label: 'Warnings', value: '${d?.summary['warn'] ?? 0}', icon: LucideIcons.triangleAlert),
                    ),
                    SizedBox(
                      width: w,
                      child: Kpi(label: 'Problems', value: '${d?.summary['fail'] ?? 0}', icon: LucideIcons.octagonX),
                    ),
                  ],
                );
              },
            ),
            for (final g in groups.entries)
              AppCard(
                title: g.key,
                padded: false,
                trailing: Pill(
                  '${g.value.where((c) => c.status == 'ok').length}/${g.value.length} ok',
                  color: g.value.any((c) => c.status == 'fail')
                      ? t.critical
                      : g.value.any((c) => c.status == 'warn')
                      ? t.warning
                      : t.good,
                ),
                child: Column(
                  children: [
                    for (final c in g.value) ...[
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(ic(c.status), size: 16, color: col(c.status)),
                            const SizedBox(width: 10),
                            SizedBox(width: 190, child: Text(c.name, style: T.calloutStrong)),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  SelectableText(c.detail, style: T.callout),
                                  if (c.fix != null)
                                    Padding(
                                      padding: const EdgeInsets.only(top: 3),
                                      child: Text('→ ${c.fix}', style: T.caption.copyWith(color: t.text3)),
                                    ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                      const Divider(),
                    ],
                  ],
                ),
              ),
          ],
        );
      },
    );
  }
}

// =================================================================== settings

class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key});
  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  BridgeConfig? saved, draft;
  String file = '', rulesFile = '', savedRules = '';
  final rules = TextEditingController();
  Object? error;

  @override
  void initState() {
    super.initState();
    _load();
    rules.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    rules.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final b = context.read<AppState>().broker;
    try {
      final c = await b.get('/api/config', (j) => (BridgeConfig.fromJson(j['config']), j['file'] as String? ?? ''));
      final r = await b.get('/api/rules', (j) => (j['rules'] as String? ?? '', j['file'] as String? ?? ''));
      if (!mounted) return;
      setState(() {
        saved = c.$1;
        draft = c.$1.copy();
        file = c.$2;
        rules.text = r.$1;
        savedRules = r.$1;
        rulesFile = r.$2;
        error = null;
      });
    } catch (e) {
      if (mounted) setState(() => error = e);
    }
  }

  Future<void> _save() async {
    final app = context.read<AppState>();
    try {
      final r = await app.broker.put('/api/config', draft!.toJson());
      setState(() {
        saved = BridgeConfig.fromJson(r['config']);
        draft = saved!.copy();
      });
      app.notify('Settings saved', 'They apply to the next message.');
    } catch (e) {
      app.notify('Not saved', e.toString(), true);
    }
  }

  Future<void> _saveRules() async {
    final app = context.read<AppState>();
    try {
      final r = await app.broker.put('/api/rules', {'rules': rules.text});
      setState(() {
        savedRules = r['rules'] as String? ?? '';
        rules.text = savedRules;
      });
      app.notify('Rules saved', 'Every linked chat gets them with its next prompt.');
    } catch (e) {
      app.notify('Not saved', e.toString(), true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final app = context.read<AppState>();
    final d = draft;
    final dirty = d != null && d != saved;
    Widget field(String label, String help, Widget control) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 320,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: T.calloutStrong),
                const SizedBox(height: 2),
                Text(help, style: T.caption.copyWith(color: t.text3)),
              ],
            ),
          ),
          const SizedBox(width: 24),
          control,
        ],
      ),
    );
    Widget stepper(int v, int min, int max, int step, String unit, ValueChanged<int> on) => Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(unit, style: T.callout),
        const SizedBox(width: 8),
        IconBtn(LucideIcons.minus, tooltip: 'Less', onPressed: v - step < min ? null : () => on(v - step)),
        IconBtn(LucideIcons.plus, tooltip: 'More', onPressed: v + step > max ? null : () => on(v + step)),
      ],
    );
    Widget text(String v, ValueChanged<String> on, {double width = 260}) => SizedBox(
      width: width,
      child: TextFormField(
        key: ValueKey('${saved.hashCode}$v'.hashCode),
        initialValue: v,
        style: T.callout,
        decoration: const InputDecoration(hintText: 'default'),
        onChanged: on,
      ),
    );
    return PageScroll(
      children: [
        Row(
          children: [
            Expanded(
              child: Text('Stored in $file', style: T.caption.copyWith(color: t.text3)),
            ),
            Btn('Discard', onPressed: dirty ? () => setState(() => draft = saved!.copy()) : null),
            const SizedBox(width: 8),
            Btn('Save changes', icon: LucideIcons.check, primary: true, onPressed: dirty ? _save : null),
          ],
        ),
        if (error != null) ErrorBanner(error!, retry: _load),
        if (d != null)
          AppCard(
            title: 'Behaviour',
            child: Column(
              children: [
                field(
                  "Default delivery",
                  "Visible puts messages into the other app's chat window; headless runs its CLI in the background and returns the answer. Auto uses visible when the app is installed.",
                  Segmented<String>(
                    value: d.delivery,
                    options: const [('auto', 'Auto'), ('visible', 'Visible'), ('headless', 'Headless')],
                    onChanged: (v) => setState(() => d.delivery = v),
                  ),
                ),
                field(
                  'Auto mode reviews',
                  'Key moments: the agent asks at the moments that matter, checked at the end of each turn. Every turn: each turn goes to the reviewer automatically.',
                  Segmented<String>(
                    value: d.autoReviews,
                    options: const [('key-moments', 'Key moments'), ('every-turn', 'Every turn')],
                    onChanged: (v) => setState(() => d.autoReviews = v),
                  ),
                ),
                field(
                  'When the other app is closed',
                  'Ask: the agent asks you before opening ChatGPT or a Claude session. Always: open it without asking.',
                  Segmented<String>(
                    value: d.openClosedApps,
                    options: const [('ask', 'Ask me'), ('always', 'Always open')],
                    onChanged: (v) => setState(() => d.openClosedApps = v),
                  ),
                ),
                field(
                  'Reading reviewer chats',
                  'Whether a chat may read another chat that is currently reviewing for someone.',
                  Segmented<String>(
                    value: d.readChatsInReviewers,
                    options: const [('deny', 'Refuse'), ('allow', 'Allow')],
                    onChanged: (v) => setState(() => d.readChatsInReviewers = v),
                  ),
                ),
                field(
                  'Emergency stop',
                  'Rounds without approval before the fix loop stops and the agent must ask you.',
                  stepper(d.maxRounds, 1, 100, 1, '${d.maxRounds} rounds', (v) => setState(() => d.maxRounds = v)),
                ),
                field(
                  'ChatGPT reviewer model',
                  "Model for new ChatGPT reviewer chats (id or picker name). Empty: the app's default.",
                  text(d.chatgptModel, (v) => setState(() => d.chatgptModel = v)),
                ),
                field(
                  'ChatGPT reasoning effort',
                  "low, medium, high… Empty: the model's default.",
                  text(d.chatgptEffort, (v) => setState(() => d.chatgptEffort = v)),
                ),
                field(
                  'Claude headless model',
                  "Model for headless Claude runs (e.g. opus, sonnet). Empty: Claude's default.",
                  text(d.claudeModel, (v) => setState(() => d.claudeModel = v)),
                ),
                field(
                  'Headless time limit',
                  'How long a background run may take before it is given up.',
                  stepper(d.headlessTimeoutSec, 60, 7200, 60, '${d.headlessTimeoutSec ~/ 60} minutes', (v) => setState(() => d.headlessTimeoutSec = v)),
                ),
                field(
                  'Paste diffs into requests',
                  'Off: reviewers read the changes themselves with the commands given (smaller messages).',
                  Switch(value: d.includeDiff, onChanged: (v) => setState(() => d.includeDiff = v)),
                ),
                field(
                  'History retention',
                  'Closed conversations and events older than this are deleted.',
                  stepper(d.retentionDays, 1, 365, 1, '${d.retentionDays} days', (v) => setState(() => d.retentionDays = v)),
                ),
                const Divider(),
                field(
                  'Broker port',
                  'Port on 127.0.0.1. Takes effect after the broker restarts.',
                  SizedBox(
                    width: 100,
                    child: TextFormField(
                      initialValue: '${d.port}',
                      style: T.callout,
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                      onChanged: (v) => setState(() => d.port = int.tryParse(v) ?? d.port),
                    ),
                  ),
                ),
              ],
            ),
          ),
        AppCard(
          title: 'Your rules',
          subtitle: 'Standing instructions every linked chat receives from your own file (never from the other agent). Up to 8,000 characters.',
          trailing: Btn('Save rules', onPressed: rules.text != savedRules ? _saveRules : null),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: rules,
                maxLines: 8,
                minLines: 6,
                style: T.mono.copyWith(fontSize: 12.5),
                decoration: const InputDecoration(hintText: 'Always answer in English.\nNever commit without my approval.'),
              ),
              const SizedBox(height: 6),
              Row(
                children: [
                  Expanded(
                    child: Text(rulesFile, style: T.mono.copyWith(fontSize: 11, color: t.text3)),
                  ),
                  Text('${rules.text.length} / 8000', style: T.caption.copyWith(color: rules.text.length > 8000 ? t.critical : t.text3)),
                ],
              ),
            ],
          ),
        ),
        AppCard(
          title: 'Maintenance',
          child: Column(
            children: [
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Delete old history now', style: T.calloutStrong),
                        Text(
                          'Removes closed conversations and events older than ${d?.retentionDays ?? 30} days. This also runs automatically every 6 hours.',
                          style: T.caption.copyWith(color: t.text3),
                        ),
                      ],
                    ),
                  ),
                  Btn(
                    'Prune now',
                    destructive: true,
                    onPressed: () async {
                      if (!await confirm(
                        context,
                        title: 'Delete old history?',
                        message: 'Closed conversations and events older than ${d?.retentionDays ?? 30} days are deleted permanently.',
                        button: 'Delete',
                        destructive: true,
                      ))
                        return;
                      try {
                        final r = await app.broker.post('/api/maintenance/prune');
                        app.notify('History pruned', '${r['links']} conversations and ${r['events']} events removed.');
                      } catch (e) {
                        app.notify('Prune failed', e.toString(), true);
                      }
                    },
                  ),
                ],
              ),
              const SizedBox(height: 12),
              const Divider(),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Web dashboard', style: T.calloutStrong),
                        Text('The same UI in your browser.', style: T.caption.copyWith(color: t.text3)),
                      ],
                    ),
                  ),
                  Btn('Open in browser', icon: LucideIcons.compass, onPressed: () => app.broker.openWebDashboard()),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}
