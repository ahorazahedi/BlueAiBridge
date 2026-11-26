// Shared building blocks, styled like the macOS app.

import 'package:material_ui/material_ui.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';

import '../api/broker.dart';
import '../api/models.dart';
import '../state/app_state.dart';
import '../theme/tokens.dart';
import '../util/format.dart';

// ---------------------------------------------------------------- surfaces

class AppCard extends StatelessWidget {
  final String? title;
  final String? subtitle;
  final Widget? trailing;
  final Widget child;
  final bool padded;
  const AppCard({super.key, this.title, this.subtitle, this.trailing, required this.child, this.padded = true});

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    return Container(
      decoration: BoxDecoration(
        color: t.card,
        borderRadius: BorderRadius.circular(radiusCard),
        border: Border.all(color: t.cardBorder),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (title != null) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(title!, style: T.headline),
                        if (subtitle != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 2),
                            child: Text(subtitle!, style: T.caption.copyWith(color: t.text3)),
                          ),
                      ],
                    ),
                  ),
                  ?trailing,
                ],
              ),
            ),
            const Divider(),
          ],
          padded ? Padding(padding: const EdgeInsets.all(16), child: child) : child,
        ],
      ),
    );
  }
}

class Kpi extends StatelessWidget {
  final String label, value;
  final IconData icon;
  final String? hint;
  final Color? hintColor, valueColor;
  const Kpi({super.key, required this.label, required this.value, required this.icon, this.hint, this.hintColor, this.valueColor});

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: t.card,
        borderRadius: BorderRadius.circular(radiusCard),
        border: Border.all(color: t.cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 13, color: t.text2),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  label,
                  style: T.caption.copyWith(color: t.text2),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            value,
            style: T.kpi.copyWith(color: valueColor ?? t.text),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 6),
          Text(
            hint ?? ' ',
            style: T.caption.copyWith(color: hintColor ?? t.text3),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }
}

/// A page with scrolling content.
class PageScroll extends StatelessWidget {
  final List<Widget> children;
  const PageScroll({super.key, required this.children});
  @override
  Widget build(BuildContext context) => SingleChildScrollView(
    padding: const EdgeInsets.all(20),
    child: Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 1500),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var i = 0; i < children.length; i++) ...[if (i > 0) const SizedBox(height: 16), children[i]],
          ],
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------- badges

class Pill extends StatelessWidget {
  final String text;
  final IconData? icon;
  final Color? color;
  final bool filled;
  const Pill(this.text, {super.key, this.icon, this.color, this.filled = true});
  @override
  Widget build(BuildContext context) {
    final c = color ?? context.t.text2;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2.5),
      decoration: BoxDecoration(
        color: filled ? c.withValues(alpha: 0.14) : Colors.transparent,
        borderRadius: BorderRadius.circular(999),
        border: filled ? null : Border.all(color: c.withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[Icon(icon, size: 10, color: c), const SizedBox(width: 4)],
          Text(
            text,
            style: T.caption.copyWith(color: c, fontWeight: FontWeight.w600),
            maxLines: 1,
          ),
        ],
      ),
    );
  }
}

IconData appIcon(String? app) => app == 'claude'
    ? LucideIcons.asterisk
    : app == 'codex'
    ? LucideIcons.hexagon
    : LucideIcons.waypoints;

class AppBadge extends StatelessWidget {
  final Endpoint? endpoint;
  final bool showId;
  const AppBadge(this.endpoint, {super.key, this.showId = false});
  @override
  Widget build(BuildContext context) {
    final e = endpoint;
    if (e == null) return Pill('BlueAIBridge', color: context.t.brand);
    final c = context.t.app(e.app);
    return Tooltip(
      message: e.key,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2.5),
        decoration: BoxDecoration(color: c.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(999)),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(appIcon(e.app), size: 10, color: c),
            const SizedBox(width: 4),
            Text(
              e.appName,
              style: T.caption.copyWith(color: c, fontWeight: FontWeight.w600),
            ),
            if (showId) ...[const SizedBox(width: 4), Text(Fmt.shortId(e.id), style: T.mono.copyWith(fontSize: 10.5, color: c.withValues(alpha: 0.8)))],
          ],
        ),
      ),
    );
  }
}

class Avatar extends StatelessWidget {
  final String? app;
  final double size;
  const Avatar(this.app, {super.key, this.size = 32});
  @override
  Widget build(BuildContext context) {
    final colors = app == 'claude'
        ? const [Color(0xFFD97757), Color(0xFFB4532F)]
        : app == 'codex'
        ? const [Color(0xFF10A37F), Color(0xFF0B6E57)]
        : app == 'user'
        ? const [Color(0xFF64748B), Color(0xFF334155)]
        : const [Color(0xFF3B82F6), Color(0xFF1D4ED8)];
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(size * 0.28),
        gradient: LinearGradient(colors: colors, begin: Alignment.topLeft, end: Alignment.bottomRight),
      ),
      child: Icon(app == 'user' ? LucideIcons.user : appIcon(app), color: Colors.white, size: size * 0.48),
    );
  }
}

class StateBadge extends StatelessWidget {
  final String state;
  const StateBadge(this.state, {super.key});
  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final (String label, IconData icon, Color color) = switch (state) {
      'pending' => ('Pending', LucideIcons.clock, t.text2),
      'deferred' => ('Waiting', LucideIcons.clock, t.warning),
      'sending' => ('Sending', LucideIcons.circleArrowUp, t.brand),
      'delivered' => ('Delivered', LucideIcons.check, t.good),
      'answered' => ('Answered', LucideIcons.circleCheck, t.good),
      'failed' => ('Failed', LucideIcons.octagonX, t.critical),
      'cancelled' => ('Cancelled', LucideIcons.x, t.text2),
      'open' => ('Open', LucideIcons.circleDot, t.brand),
      'waiting_join' => ('Waiting to join', LucideIcons.clock, t.warning),
      'closed' => ('Closed', LucideIcons.x, t.text2),
      _ => (state, LucideIcons.circle, t.text2),
    };
    return Pill(label, icon: icon, color: color);
  }
}

class DecisionBadge extends StatelessWidget {
  final String? decision;
  const DecisionBadge(this.decision, {super.key});
  @override
  Widget build(BuildContext context) {
    if (decision == 'approved') return Pill('Approved', icon: LucideIcons.badgeCheck, color: context.t.good);
    if (decision == 'changes_requested') return Pill('Changes requested', icon: LucideIcons.triangleAlert, color: context.t.warning);
    return const SizedBox.shrink();
  }
}

// ---------------------------------------------------------------- states

class EmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? message;
  final Widget? action;
  const EmptyState({super.key, required this.icon, required this.title, this.message, this.action});
  @override
  Widget build(BuildContext context) {
    final t = context.t;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 44, color: t.text3),
            const SizedBox(height: 14),
            Text(
              title,
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
              textAlign: TextAlign.center,
            ),
            if (message != null) ...[
              const SizedBox(height: 8),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 440),
                child: Text(
                  message!,
                  style: T.body.copyWith(color: t.text2),
                  textAlign: TextAlign.center,
                ),
              ),
            ],
            if (action != null) ...[const SizedBox(height: 14), action!],
          ],
        ),
      ),
    );
  }
}

class ErrorBanner extends StatelessWidget {
  final Object error;
  final VoidCallback? retry;
  const ErrorBanner(this.error, {super.key, this.retry});
  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final app = context.read<AppState>();
    final notRunning = error is BrokerException && (error as BrokerException).notRunning;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: t.critical.withValues(alpha: 0.09), borderRadius: BorderRadius.circular(10)),
      child: Row(
        children: [
          Icon(LucideIcons.octagonX, color: t.critical, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text("Couldn't load this", style: T.calloutStrong),
                Text(error.toString(), style: T.caption.copyWith(color: t.text2)),
              ],
            ),
          ),
          if (notRunning && app.broker.cli() != null) Btn('Start broker', onPressed: app.startBroker),
          if (retry != null) ...[const SizedBox(width: 8), Btn('Retry', onPressed: retry)],
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------- controls

/// A macOS-style push button.
class Btn extends StatelessWidget {
  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final bool primary, destructive, small;
  const Btn(this.label, {super.key, this.icon, this.onPressed, this.primary = false, this.destructive = false, this.small = false});
  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final bg = primary ? t.accent : (dark ? const Color(0xFF3A3A3C) : Colors.white);
    final fg = primary
        ? Colors.white
        : destructive
        ? t.critical
        : t.text;
    return Opacity(
      opacity: onPressed == null ? 0.5 : 1,
      child: Material(
        color: bg,
        borderRadius: BorderRadius.circular(6),
        child: InkWell(
          onTap: onPressed,
          borderRadius: BorderRadius.circular(6),
          hoverColor: Colors.white.withValues(alpha: 0.06),
          child: Container(
            padding: EdgeInsets.symmetric(horizontal: small ? 8 : 11, vertical: small ? 3.5 : 5.5),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(6),
              border: primary ? null : Border.all(color: t.cardBorder),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (icon != null) ...[Icon(icon, size: small ? 12 : 13, color: fg), const SizedBox(width: 6)],
                Text(
                  label,
                  style: (small ? T.caption : T.callout).copyWith(color: fg, fontWeight: FontWeight.w500),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class LinkText extends StatelessWidget {
  final String label;
  final VoidCallback onTap;
  const LinkText(this.label, {super.key, required this.onTap});
  @override
  Widget build(BuildContext context) => MouseRegion(
    cursor: SystemMouseCursors.click,
    child: GestureDetector(
      onTap: onTap,
      child: Text(label, style: T.callout.copyWith(color: context.t.accent)),
    ),
  );
}

class IconBtn extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;
  final double size;
  const IconBtn(this.icon, {super.key, required this.tooltip, this.onPressed, this.size = 15});
  @override
  Widget build(BuildContext context) => Tooltip(
    message: tooltip,
    child: InkWell(
      borderRadius: BorderRadius.circular(6),
      onTap: onPressed,
      child: Padding(
        padding: const EdgeInsets.all(5),
        child: Icon(icon, size: size, color: context.t.text2),
      ),
    ),
  );
}

/// A macOS-style segmented control.
class Segmented<V> extends StatelessWidget {
  final V value;
  final List<(V, String)> options;
  final ValueChanged<V> onChanged;
  final bool large;
  const Segmented({super.key, required this.value, required this.options, required this.onChanged, this.large = false});
  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(color: dark ? const Color(0xFF2C2C2E) : const Color(0xFFE3E3E6), borderRadius: BorderRadius.circular(large ? 999 : 7)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final (v, label) in options)
            GestureDetector(
              onTap: () => onChanged(v),
              child: MouseRegion(
                cursor: SystemMouseCursors.click,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 120),
                  padding: EdgeInsets.symmetric(horizontal: large ? 14 : 10, vertical: large ? 6 : 3.5),
                  decoration: BoxDecoration(
                    color: v == value ? (dark ? const Color(0xFF5A5A5E) : Colors.white) : Colors.transparent,
                    borderRadius: BorderRadius.circular(large ? 999 : 5),
                    boxShadow: v == value && !dark ? [BoxShadow(color: Colors.black.withValues(alpha: 0.08), blurRadius: 2, offset: const Offset(0, 1))] : null,
                  ),
                  child: Text(
                    label,
                    style: (large ? T.callout : T.caption).copyWith(color: v == value ? t.text : t.text2, fontWeight: FontWeight.w500),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class Dropdown<V> extends StatelessWidget {
  final V value;
  final List<(V, String)> options;
  final ValueChanged<V> onChanged;
  const Dropdown({super.key, required this.value, required this.options, required this.onChanged});
  @override
  Widget build(BuildContext context) {
    final t = context.t;
    return Container(
      height: 28,
      padding: const EdgeInsets.symmetric(horizontal: 8),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: t.cardBorder),
        color: Theme.of(context).inputDecorationTheme.fillColor,
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<V>(
          value: value,
          isDense: true,
          borderRadius: BorderRadius.circular(8),
          dropdownColor: t.card,
          icon: Icon(LucideIcons.chevronsUpDown, size: 12, color: t.text2),
          style: T.caption.copyWith(color: t.text),
          items: [for (final (v, l) in options) DropdownMenuItem(value: v, child: Text(l))],
          onChanged: (v) => v == null ? null : onChanged(v),
        ),
      ),
    );
  }
}

Future<bool> confirm(BuildContext context, {required String title, required String message, required String button, bool destructive = false}) async {
  final t = context.t;
  final r = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      backgroundColor: t.card,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      title: Text(title, style: T.title3),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Text(message, style: T.body.copyWith(color: t.text2)),
      ),
      actions: [
        Btn('Cancel', onPressed: () => Navigator.pop(c, false)),
        Btn(button, primary: !destructive, destructive: destructive, onPressed: () => Navigator.pop(c, true)),
      ],
    ),
  );
  return r == true;
}

void copyText(BuildContext context, String text) {
  Clipboard.setData(ClipboardData(text: text));
  context.read<AppState>().notify('Copied');
}

Widget progressBar(BuildContext context, double value, Color color, {double height = 6}) => ClipRRect(
  borderRadius: BorderRadius.circular(height / 2),
  child: Stack(
    children: [
      Container(height: height, color: context.t.text3.withValues(alpha: 0.2)),
      FractionallySizedBox(
        widthFactor: value.clamp(0, 1),
        child: Container(height: height, color: color),
      ),
    ],
  ),
);
