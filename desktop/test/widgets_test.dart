import 'package:blue_ai_bridge/src/api/models.dart';
import 'package:blue_ai_bridge/src/pages/conversations.dart';
import 'package:blue_ai_bridge/src/state/app_state.dart';
import 'package:blue_ai_bridge/src/theme/tokens.dart';
import 'package:blue_ai_bridge/src/widgets/components.dart';
import 'package:blue_ai_bridge/src/widgets/markdown.dart';
import 'package:material_ui/material_ui.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

Widget host(Widget child, {Brightness b = Brightness.dark}) => ChangeNotifierProvider(
  create: (_) => AppState(),
  child: MaterialApp(
    theme: buildTheme(b),
    home: Scaffold(body: SingleChildScrollView(child: child)),
  ),
);

void main() {
  testWidgets('verdict shows must-fix items and nits', (t) async {
    await t.pumpWidget(
      host(
        DecisionView(
          decision: Decision.fromJson({
            'decision': 'changes_requested',
            'note': 'Breaks on empty.',
            'blocking': ['handle `[]`'],
            'nits': ['rename'],
          }),
        ),
      ),
    );
    expect(find.text('Changes requested'), findsOneWidget);
    expect(find.text('MUST FIX'), findsOneWidget);
    expect(find.text('NITS'), findsOneWidget);
  });

  testWidgets('state and decision badges render in both themes', (t) async {
    for (final b in Brightness.values) {
      await t.pumpWidget(host(const Column(children: [StateBadge('delivered'), StateBadge('failed'), DecisionBadge('approved')]), b: b));
      expect(find.text('Delivered'), findsOneWidget);
      expect(find.text('Failed'), findsOneWidget);
      expect(find.text('Approved'), findsOneWidget);
    }
  });

  testWidgets('markdown keeps git pathspecs intact and renders code blocks', (t) async {
    await t.pumpWidget(host(const MarkdownText("Read with:\n- `git diff -- ':(exclude,glob)**/.env*'`\n\n```diff\n+added\n-removed\n```")));
    expect(find.textContaining("**/.env*", findRichText: true), findsOneWidget);
    expect(find.textContaining('+added', findRichText: true), findsOneWidget);
  });

  testWidgets('KPI card shows label, value and hint', (t) async {
    await t.pumpWidget(host(const Kpi(label: 'Messages', value: '23', icon: Icons.chat, hint: '2 waiting')));
    expect(find.text('Messages'), findsOneWidget);
    expect(find.text('23'), findsOneWidget);
    expect(find.text('2 waiting'), findsOneWidget);
  });
}
