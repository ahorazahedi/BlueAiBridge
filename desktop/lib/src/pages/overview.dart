import 'package:fl_chart/fl_chart.dart';
import 'package:material_ui/material_ui.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/app_state.dart';
import '../theme/tokens.dart';
import '../util/format.dart';
import '../widgets/components.dart';
import '../widgets/loader.dart';
import 'activity.dart';
import 'conversations.dart' show LinkRow;

class OverviewPage extends StatefulWidget {
  const OverviewPage({super.key});
  @override
  State<OverviewPage> createState() => _OverviewPageState();
}

class _OverviewData {
  final Summary summary;
  final Series series;
  final List<Link> links;
  _OverviewData(this.summary, this.series, this.links);
}

class _OverviewPageState extends State<OverviewPage> {
  Limits? limits;

  @override
  void initState() {
    super.initState();
    context
        .read<AppState>()
        .broker
        .get('/api/limits', (j) => j['limits'] == null ? null : Limits.fromJson(j['limits']), timeout: const Duration(seconds: 25))
        .then((l) {
          if (mounted) setState(() => limits = l);
        })
        .catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final r = app.range.label;
    return Loader<_OverviewData>(
      reloadKey: r,
      load: () async {
        final b = app.broker;
        final s = b.get('/api/summary?range=$r', Summary.fromJson);
        final p = b.get('/api/series?range=$r', Series.fromJson);
        final l = b.get('/api/links?limit=8', (j) => (j['links'] as List).map((e) => Link.fromJson(e)).toList());
        await Future.wait([s, p, l]); // so a failure of one isn't left unhandled while awaiting another
        return _OverviewData(await s, await p, await l);
      },
      builder: (context, d, error, reload) => PageScroll(
        children: [
          if (error != null) ErrorBanner(error, retry: reload),
          _kpis(context, d?.summary),
          LayoutBuilder(
            builder: (context, c) {
              final wide = c.maxWidth > 980;
              final traffic = AppCard(
                title: 'Traffic',
                subtitle: 'Messages through the bridge, by direction',
                trailing: const _Legend(),
                child: SizedBox(
                  height: 260,
                  child: d == null ? const SizedBox() : TrafficChart(series: d.series, rangeSeconds: app.range.seconds),
                ),
              );
              final flow = AppCard(
                title: 'Data flow',
                subtitle: 'Last ${app.range.label}',
                child: _Flow(summary: d?.summary),
              );
              return wide
                  ? IntrinsicHeight(
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Expanded(child: traffic),
                          const SizedBox(width: 16),
                          SizedBox(width: 440, child: flow),
                        ],
                      ),
                    )
                  : Column(children: [traffic, const SizedBox(height: 16), flow]);
            },
          ),
          LayoutBuilder(
            builder: (context, c) {
              final wide = c.maxWidth > 980;
              final recent = AppCard(
                title: 'Recent conversations',
                trailing: LinkText('View all', onTap: () => app.setPage(AppPage.conversations)),
                padded: false,
                child: d == null || d.links.isEmpty
                    ? const SizedBox(
                        height: 320,
                        child: EmptyState(
                          icon: LucideIcons.messagesSquare,
                          title: 'No conversations yet',
                          message: 'Ask from Claude Code: “Ask ChatGPT to review this change”, or from ChatGPT: “Ask Claude for a second opinion”.',
                        ),
                      )
                    : Column(
                        children: [
                          for (final l in d.links) ...[
                            InkWell(
                              onTap: () => app.open(AppPage.conversations, link: l.id),
                              child: LinkRow(link: l),
                            ),
                            const Divider(),
                          ],
                        ],
                      ),
              );
              final side = Column(
                children: [
                  AppCard(
                    title: 'Review verdicts',
                    subtitle: '${(d?.summary.approved ?? 0) + (d?.summary.changesRequested ?? 0)} in the last ${app.range.label}',
                    child: _Verdicts(summary: d?.summary),
                  ),
                  const SizedBox(height: 16),
                  AppCard(
                    title: 'ChatGPT usage',
                    subtitle: 'Codex rate-limit windows',
                    child: _Usage(limits: limits),
                  ),
                  const SizedBox(height: 16),
                  AppCard(
                    title: 'Live activity',
                    trailing: LinkText('All', onTap: () => app.setPage(AppPage.activity)),
                    padded: false,
                    child: const _Feed(),
                  ),
                ],
              );
              return wide
                  ? Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(child: recent),
                        const SizedBox(width: 16),
                        SizedBox(width: 440, child: side),
                      ],
                    )
                  : Column(children: [recent, const SizedBox(height: 16), side]);
            },
          ),
        ],
      ),
    );
  }

  Widget _kpis(BuildContext context, Summary? s) {
    final t = context.t;
    final failRate = s == null
        ? '—'
        : s.messages == 0
        ? '0%'
        : '${(s.failed / s.messages * 100).round()}%';
    final items = [
      Kpi(label: 'Messages', value: Fmt.num(s?.messages), icon: LucideIcons.messagesSquare, hint: s == null ? null : '${s.pending} waiting to be delivered'),
      Kpi(label: 'Data transferred', value: Fmt.bytes(s?.bytes), icon: LucideIcons.hardDrive, hint: 'Requests, answers, messages'),
      Kpi(
        label: 'Open conversations',
        value: Fmt.num(s?.openLinks),
        icon: LucideIcons.link,
        hint: s == null ? null : '${s.autosOn} auto mode${s.autosOn == 1 ? '' : 's'} on',
      ),
      Kpi(
        label: 'Avg review time',
        value: Fmt.duration(s?.avgReviewMs),
        icon: LucideIcons.timer,
        hint: s == null ? null : 'delivery ${Fmt.duration(s.avgDeliveryMs)}',
      ),
      Kpi(
        label: 'Failure rate',
        value: failRate,
        icon: LucideIcons.triangleAlert,
        hint: s == null ? null : (s.failed == 0 ? 'No failed deliveries' : '${s.failed} failed deliveries'),
        hintColor: (s?.failed ?? 0) > 0 ? t.critical : null,
      ),
      Kpi(label: 'Active chats', value: Fmt.num(s?.clients), icon: LucideIcons.users, hint: 'Seen in this range'),
    ];
    return LayoutBuilder(
      builder: (context, c) {
        final cols = c.maxWidth > 1020
            ? 6
            : c.maxWidth > 700
            ? 3
            : 2;
        final w = (c.maxWidth - 12 * (cols - 1)) / cols;
        return Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [for (final k in items) SizedBox(width: w, child: k)],
        );
      },
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend();
  @override
  Widget build(BuildContext context) {
    final t = context.t;
    Widget item(String l, Color c) => Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(2)),
        ),
        const SizedBox(width: 5),
        Text(l, style: T.caption.copyWith(color: t.text2)),
      ],
    );
    return Wrap(
      spacing: 12,
      children: [item('Claude → ChatGPT', t.claudeToGpt), item('ChatGPT → Claude', t.gptToClaude), item('BlueAIBridge notices', t.bridge)],
    );
  }
}

/// Stacked bars per time bucket, with a hover tooltip.
class TrafficChart extends StatelessWidget {
  final Series series;
  final double rangeSeconds;
  const TrafficChart({super.key, required this.series, required this.rangeSeconds});

  List<SeriesPoint> _dense() {
    final bucket = series.bucketMs;
    final now = DateTime.now().millisecondsSinceEpoch.toDouble();
    final first = ((now - rangeSeconds * 1000) / bucket).floor() * bucket;
    final map = {for (final p in series.points) p.t: p};
    final out = <SeriesPoint>[];
    for (var t = first; t <= now; t += bucket) {
      out.add(map[t] ?? SeriesPoint(t, 0, 0, 0, 0, 0));
    }
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final pts = _dense();
    final maxTotal = pts.fold<int>(0, (a, p) => p.total > a ? p.total : a);
    final maxY = _niceMax(maxTotal.toDouble());
    final fmt = series.bucketMs >= 3 * 3600000 ? DateFormat.MMMd() : DateFormat.Hm();
    final labelEvery = (pts.length / 5).ceil().clamp(1, 1000);
    return LayoutBuilder(
      builder: (context, c) {
        final barW = ((c.maxWidth - 40) / pts.length * 0.72).clamp(2.0, 26.0);
        final gap = maxY * 0.012;
        return BarChart(
          BarChartData(
            maxY: maxY,
            minY: 0,
            alignment: BarChartAlignment.spaceAround,
            gridData: FlGridData(
              drawVerticalLine: false,
              horizontalInterval: maxY / 2,
              getDrawingHorizontalLine: (_) => FlLine(color: t.text3.withValues(alpha: 0.15), strokeWidth: 1),
            ),
            borderData: FlBorderData(show: false),
            titlesData: FlTitlesData(
              topTitles: const AxisTitles(),
              rightTitles: const AxisTitles(),
              leftTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  reservedSize: 32,
                  interval: maxY / 2,
                  getTitlesWidget: (v, m) => Text(NumberFormat.compact().format(v), style: T.caption2.copyWith(color: t.text3)),
                ),
              ),
              bottomTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  reservedSize: 22,
                  getTitlesWidget: (v, m) {
                    final i = v.toInt();
                    if (i < 0 || i >= pts.length || i % labelEvery != 0) return const SizedBox();
                    return Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(fmt.format(pts[i].date), style: T.caption2.copyWith(color: t.text3)),
                    );
                  },
                ),
              ),
            ),
            barTouchData: BarTouchData(
              touchTooltipData: BarTouchTooltipData(
                getTooltipColor: (_) => t.card,
                tooltipBorder: BorderSide(color: t.cardBorder),
                tooltipBorderRadius: BorderRadius.circular(8),
                fitInsideHorizontally: true,
                fitInsideVertically: true,
                getTooltipItem: (group, gi, rod, ri) {
                  final p = pts[group.x];
                  return BarTooltipItem(
                    '${DateFormat('MMM d, HH:mm').format(p.date)}\n',
                    T.caption.copyWith(color: t.text, fontWeight: FontWeight.w600),
                    textAlign: TextAlign.left,
                    children: [
                      TextSpan(
                        text: '■ ',
                        style: TextStyle(color: t.claudeToGpt),
                      ),
                      TextSpan(
                        text: 'Claude → ChatGPT  ${p.claudeToChatgpt}\n',
                        style: T.caption.copyWith(color: t.text2),
                      ),
                      TextSpan(
                        text: '■ ',
                        style: TextStyle(color: t.gptToClaude),
                      ),
                      TextSpan(
                        text: 'ChatGPT → Claude  ${p.chatgptToClaude}\n',
                        style: T.caption.copyWith(color: t.text2),
                      ),
                      TextSpan(
                        text: '■ ',
                        style: TextStyle(color: t.bridge),
                      ),
                      TextSpan(
                        text: 'Notices  ${p.bridge}\n',
                        style: T.caption.copyWith(color: t.text2),
                      ),
                      TextSpan(
                        text: 'Data  ${Fmt.bytes(p.bytes)}',
                        style: T.caption.copyWith(color: t.text3),
                      ),
                      if (p.failed > 0)
                        TextSpan(
                          text: '\nFailed  ${p.failed}',
                          style: T.caption.copyWith(color: t.critical),
                        ),
                    ],
                  );
                },
              ),
            ),
            barGroups: [for (var i = 0; i < pts.length; i++) _group(i, pts[i], barW, gap, t)],
          ),
          duration: const Duration(milliseconds: 250),
        );
      },
    );
  }

  BarChartGroupData _group(int i, SeriesPoint p, double w, double gap, Tokens t) {
    final segs = <BarChartRodStackItem>[];
    var acc = 0.0;
    for (final (v, c) in [(p.claudeToChatgpt, t.claudeToGpt), (p.chatgptToClaude, t.gptToClaude), (p.bridge, t.bridge)]) {
      if (v <= 0) continue;
      final from = acc + (acc > 0 ? gap : 0);
      acc += v;
      segs.add(BarChartRodStackItem(from, acc, c));
    }
    return BarChartGroupData(
      x: i,
      barRods: [
        BarChartRodData(
          toY: acc == 0 ? 0 : acc,
          width: w,
          color: Colors.transparent,
          rodStackItems: segs,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(2)),
        ),
      ],
    );
  }

  static double _niceMax(double v) {
    if (v <= 4) return 4;
    final p = _pow10((v).toString().split('.').first.length - 1);
    final n = v / p;
    return (n <= 1
            ? 1
            : n <= 2
            ? 2
            : n <= 5
            ? 5
            : 10) *
        p;
  }

  static double _pow10(int e) {
    var r = 1.0;
    for (var i = 0; i < e; i++) {
      r *= 10;
    }
    return r;
  }
}

class _Flow extends StatelessWidget {
  final Summary? summary;
  const _Flow({required this.summary});
  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final dirs = summary?.byDirection ?? const <DirectionRow>[];
    (int, int) sum(String from) => dirs.where((d) => d.from == from).fold((0, 0), (a, d) => (a.$1 + d.messages, a.$2 + d.bytes));
    final c2g = sum('claude');
    final g2c = sum('codex');
    final channels = (summary?.byChannel ?? const <ChannelRow>[]).where((c) => c.channel != 'none').toList();
    final maxC = channels.fold<int>(1, (a, c) => c.messages > a ? c.messages : a);
    Widget node(String name, String app, String sub) => Container(
      width: 118,
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: t.cardBorder),
      ),
      child: Column(
        children: [
          Avatar(app, size: 30),
          const SizedBox(height: 6),
          Text(name, style: T.calloutStrong),
          const SizedBox(height: 2),
          Text(sub, style: T.caption2.copyWith(color: t.text3)),
        ],
      ),
    );
    Widget arrow(String label, Color c, bool right) => Column(
      children: [
        Text(label, style: T.caption2.copyWith(color: t.text2), maxLines: 1),
        const SizedBox(height: 3),
        Row(
          children: [
            if (!right) Icon(LucideIcons.chevronLeft, size: 10, color: c),
            Expanded(child: Container(height: 2.5, color: c)),
            if (right) Icon(LucideIcons.chevronRight, size: 10, color: c),
          ],
        ),
      ],
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            node('Claude', 'claude', 'Code tab · CLI'),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                children: [
                  arrow('${c2g.$1} msgs · ${Fmt.bytes(c2g.$2)}', t.claudeToGpt, true),
                  const SizedBox(height: 14),
                  arrow('${g2c.$1} msgs · ${Fmt.bytes(g2c.$2)}', t.gptToClaude, false),
                ],
              ),
            ),
            const SizedBox(width: 10),
            node('ChatGPT', 'codex', 'Desktop · CLI'),
          ],
        ),
        if (channels.isNotEmpty) ...[
          const SizedBox(height: 14),
          const Divider(),
          const SizedBox(height: 10),
          for (final c in channels) ...[
            Row(
              children: [
                Expanded(child: Text(Fmt.channelLabel(c.channel), style: T.caption)),
                Text('${c.messages}', style: T.caption.copyWith(fontWeight: FontWeight.w600)),
                const SizedBox(width: 6),
                Text(Fmt.bytes(c.bytes), style: T.caption.copyWith(color: t.text3)),
              ],
            ),
            const SizedBox(height: 4),
            progressBar(
              context,
              c.messages / maxC,
              c.channel == 'headless'
                  ? t.gptToClaude
                  : c.channel == 'note'
                  ? t.bridge
                  : t.claudeToGpt,
            ),
            const SizedBox(height: 10),
          ],
        ],
      ],
    );
  }
}

class _Verdicts extends StatelessWidget {
  final Summary? summary;
  const _Verdicts({required this.summary});
  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final a = summary?.approved ?? 0;
    final c = summary?.changesRequested ?? 0;
    final total = a + c;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (total == 0)
          Text('No verdicts yet.', style: T.caption.copyWith(color: t.text3))
        else
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: SizedBox(
              height: 12,
              child: Row(
                children: [
                  if (a > 0)
                    Expanded(
                      flex: a,
                      child: Container(color: t.good),
                    ),
                  if (a > 0 && c > 0) const SizedBox(width: 2),
                  if (c > 0)
                    Expanded(
                      flex: c,
                      child: Container(color: t.warningMark),
                    ),
                ],
              ),
            ),
          ),
        const SizedBox(height: 12),
        Row(
          children: [
            Icon(LucideIcons.badgeCheck, size: 15, color: t.good),
            const SizedBox(width: 8),
            Expanded(
              child: Text('Approved', style: T.callout.copyWith(color: t.good)),
            ),
            Text('$a', style: T.calloutStrong),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Icon(LucideIcons.triangleAlert, size: 15, color: t.warning),
            const SizedBox(width: 8),
            Expanded(
              child: Text('Changes requested', style: T.callout.copyWith(color: t.warning)),
            ),
            Text('$c', style: T.calloutStrong),
          ],
        ),
      ],
    );
  }
}

class _Usage extends StatelessWidget {
  final Limits? limits;
  const _Usage({required this.limits});
  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final l = limits;
    if (l == null) return Text('Not available (ChatGPT Desktop not installed or not signed in).', style: T.caption.copyWith(color: t.text3));
    Widget win(String label, LimitWindow? w) => w == null
        ? const SizedBox()
        : Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(child: Text(label, style: T.caption)),
                    Text('${w.usedPercent.round()}% used', style: T.caption.copyWith(fontWeight: FontWeight.w600)),
                    if (w.resetsAt != null) Text('  · resets ${Fmt.ago(w.resetsAt)}', style: T.caption.copyWith(color: t.text3)),
                  ],
                ),
                const SizedBox(height: 6),
                progressBar(
                  context,
                  w.usedPercent / 100,
                  w.usedPercent >= 90
                      ? t.critical
                      : w.usedPercent >= 70
                      ? t.warningMark
                      : t.claudeToGpt,
                ),
              ],
            ),
          );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (l.blocked)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Pill('Limit reached — reviews wait for the reset', icon: LucideIcons.octagonX, color: t.critical),
          ),
        win('Primary window', l.primary),
        win('Secondary window', l.secondary),
      ],
    );
  }
}

class _Feed extends StatelessWidget {
  const _Feed();
  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final evs = app.events.where((e) => !e.type.startsWith('tool.') && e.type != 'client.seen' && e.type != 'message.created').take(7).toList();
    if (evs.isEmpty)
      return Padding(
        padding: const EdgeInsets.all(14),
        child: Text('Waiting for activity…', style: T.caption.copyWith(color: context.t.text3)),
      );
    return Column(
      children: [
        for (final e in evs) ...[EventRow(event: e, compact: true), const Divider()],
      ],
    );
  }
}
