// Agent text: fenced code (diff-colored), headings, bullets, inline `code`,
// **bold** and *italic*. Everything is plain text spans; nothing is executed.

import 'package:material_ui/material_ui.dart';

import '../theme/tokens.dart';

class MarkdownText extends StatelessWidget {
  final String text;
  final TextStyle? style;
  const MarkdownText(this.text, {super.key, this.style});

  @override
  Widget build(BuildContext context) {
    final t = context.t;
    final base = style ?? T.callout.copyWith(color: t.text, height: 1.45);
    final out = <Widget>[];
    final lines = text.replaceAll('\r\n', '\n').split('\n');
    final para = <String>[];
    void flush() {
      if (para.isEmpty) return;
      out.add(SelectableText.rich(TextSpan(children: inline(context, para.join('\n'), base)), style: base));
      para.clear();
    }

    for (var i = 0; i < lines.length; i++) {
      final l = lines[i];
      final tl = l.trim();
      if (tl.startsWith('```')) {
        flush();
        final code = <String>[];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          code.add(lines[i]);
          i++;
        }
        out.add(
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: t.text.withValues(alpha: 0.05), borderRadius: BorderRadius.circular(8)),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: SelectableText.rich(
                TextSpan(
                  children: [
                    for (final c in code)
                      TextSpan(
                        text: '${c.isEmpty ? ' ' : c}\n',
                        style: T.mono.copyWith(
                          fontSize: 11.5,
                          color: c.startsWith('+') && !c.startsWith('+++')
                              ? t.good
                              : c.startsWith('-') && !c.startsWith('---')
                              ? t.critical
                              : t.text,
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        );
      } else if (RegExp(r'^#{1,4}\s+').hasMatch(tl)) {
        flush();
        out.add(
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text.rich(
              TextSpan(children: inline(context, tl.replaceFirst(RegExp(r'^#{1,4}\s+'), ''), base.copyWith(fontWeight: FontWeight.w600))),
              style: base.copyWith(fontWeight: FontWeight.w600),
            ),
          ),
        );
      } else if (RegExp(r'^([-*•]|\d+[.)])\s+').hasMatch(tl)) {
        flush();
        final m = RegExp(r'^([-*•]|\d+[.)])\s+').firstMatch(tl)!;
        final marker = RegExp(r'^\d').hasMatch(m.group(1)!) ? m.group(1)! : '•';
        out.add(
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 18,
                child: Text(marker, style: base.copyWith(color: t.text3)),
              ),
              Expanded(
                child: SelectableText.rich(TextSpan(children: inline(context, tl.substring(m.end), base)), style: base),
              ),
            ],
          ),
        );
      } else if (tl.isEmpty) {
        flush();
      } else {
        para.add(l);
      }
    }
    flush();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < out.length; i++) ...[if (i > 0) const SizedBox(height: 6), out[i]],
      ],
    );
  }

  static final _inline = RegExp(r'(`[^`]+`|\*\*[^*\s][^*]*\*\*|(?<=^|\s)\*[^*\s](?:[^*]*[^*\s])?\*(?=$|\s|[.,;:!?)]))');

  static List<InlineSpan> inline(BuildContext context, String s, TextStyle base) {
    final t = context.t;
    final spans = <InlineSpan>[];
    var last = 0;
    for (final m in _inline.allMatches(s)) {
      if (m.start > last) spans.add(TextSpan(text: s.substring(last, m.start)));
      final tok = m.group(0)!;
      if (tok.startsWith('`')) {
        spans.add(
          TextSpan(
            text: tok.substring(1, tok.length - 1),
            style: T.mono.copyWith(fontSize: 12, color: t.text, backgroundColor: t.text.withValues(alpha: 0.07)),
          ),
        );
      } else if (tok.startsWith('**')) {
        spans.add(
          TextSpan(
            text: tok.substring(2, tok.length - 2),
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
        );
      } else {
        spans.add(
          TextSpan(
            text: tok.substring(1, tok.length - 1),
            style: const TextStyle(fontStyle: FontStyle.italic),
          ),
        );
      }
      last = m.end;
    }
    if (last < s.length) spans.add(TextSpan(text: s.substring(last)));
    return spans;
  }
}
