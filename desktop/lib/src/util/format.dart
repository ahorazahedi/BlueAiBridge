import 'package:intl/intl.dart';

class Fmt {
  static String bytes(int? n) {
    if (n == null) return '—';
    if (n == 0) return 'Zero KB';
    if (n < 1000) return '$n bytes';
    if (n < 1000 * 1000) return '${(n / 1000).toStringAsFixed(n < 10000 ? 1 : 0)} KB';
    if (n < 1000 * 1000 * 1000) return '${(n / 1e6).toStringAsFixed(1)} MB';
    return '${(n / 1e9).toStringAsFixed(2)} GB';
  }

  static String num(int? n) => n == null ? '—' : (n >= 10000 ? NumberFormat.compact().format(n) : NumberFormat.decimalPattern().format(n));

  static String duration(double? ms) {
    if (ms == null) return '—';
    if (ms < 1000) return '${ms.round()} ms';
    final s = ms / 1000;
    if (s < 60) return s < 10 ? '${s.toStringAsFixed(1)} s' : '${s.round()} s';
    final m = s ~/ 60;
    if (m < 60) return '${m}m ${(s % 60).round()}s';
    return '${m ~/ 60}h ${m % 60}m';
  }

  static DateTime? date(double? ms) => ms == null ? null : DateTime.fromMillisecondsSinceEpoch(ms.toInt());

  static String ago(double? ms) {
    final d = date(ms);
    if (d == null) return '—';
    final diff = DateTime.now().difference(d);
    final future = diff.isNegative;
    final a = diff.abs();
    String unit(int v, String u) => future ? 'in $v $u${v == 1 ? '' : 's'}' : '$v $u${v == 1 ? '' : 's'} ago';
    if (a.inSeconds < 45) return 'just now';
    if (a.inMinutes < 60) return unit(a.inMinutes.clamp(1, 59), 'minute');
    if (a.inHours < 24) return unit(a.inHours, 'hour');
    if (a.inDays < 30) return unit(a.inDays, 'day');
    return DateFormat.yMMMd().format(d);
  }

  static String time(double? ms) => ms == null ? '—' : DateFormat.Hms().format(date(ms)!);
  static String dateTime(double? ms) => ms == null ? '—' : DateFormat('MMM d, y \'at\' HH:mm').format(date(ms)!);
  static String shortId(String id) => id.length > 14 ? '${id.substring(0, 8)}…${id.substring(id.length - 4)}' : id;
  static String appName(String? a) => a == 'claude'
      ? 'Claude'
      : a == 'codex'
      ? 'ChatGPT'
      : 'BlueAIBridge';
  static String kindLabel(String k) => const {'review': 'Review', 'auto': 'Auto mode', 'ask': 'Question', 'turn': 'Turn review'}[k] ?? k;
  static String channelLabel(String c) =>
      const {
        'visible': "Visible (in the app's chat)",
        'headless': 'Headless (background CLI)',
        'inline': 'Inline (tool result)',
        'note': 'With the next prompt',
      }[c] ??
      c;
}
