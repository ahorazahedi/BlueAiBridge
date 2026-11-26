// Design tokens: the same palette, radii and type scale as the macOS (SwiftUI)
// app, so BlueAIBridge looks the same on macOS, Windows and Linux.

import 'package:material_ui/material_ui.dart';

@immutable
class Tokens extends ThemeExtension<Tokens> {
  final Color window, sidebar, card, cardBorder, hover, text, text2, text3, separator, accent, selection;
  // data series (validated categorical order: blue, orange, aqua)
  final Color claudeToGpt, gptToClaude, bridge;
  // status (reserved; always paired with an icon + label)
  final Color good, warning, warningMark, critical;
  // app identity
  final Color claude, gpt, brand;

  const Tokens({
    required this.window,
    required this.sidebar,
    required this.card,
    required this.cardBorder,
    required this.hover,
    required this.text,
    required this.text2,
    required this.text3,
    required this.separator,
    required this.accent,
    required this.selection,
    required this.claudeToGpt,
    required this.gptToClaude,
    required this.bridge,
    required this.good,
    required this.warning,
    required this.warningMark,
    required this.critical,
    required this.claude,
    required this.gpt,
    required this.brand,
  });

  static const dark = Tokens(
    window: Color(0xFF1E1E1E),
    sidebar: Color(0xFF282828),
    card: Color(0xFF232323),
    cardBorder: Color(0xFF353535),
    hover: Color(0xFF2E2E2E),
    text: Color(0xFFF2F2F2),
    text2: Color(0xFFBDBDBD),
    text3: Color(0xFF8E8E93),
    separator: Color(0xFF353535),
    accent: Color(0xFF2F6FE4),
    selection: Color(0xFF1F5FD6),
    claudeToGpt: Color(0xFF3987E5),
    gptToClaude: Color(0xFFD95926),
    bridge: Color(0xFF199E70),
    good: Color(0xFF22C55E),
    warning: Color(0xFFFAB219),
    warningMark: Color(0xFFFAB219),
    critical: Color(0xFFF06A6A),
    claude: Color(0xFFE48A66),
    gpt: Color(0xFF3CC2B1),
    brand: Color(0xFF4F8DF5),
  );

  static const light = Tokens(
    window: Color(0xFFF5F5F7),
    sidebar: Color(0xFFEAEAEC),
    card: Color(0xFFFFFFFF),
    cardBorder: Color(0xFFDCDCE0),
    hover: Color(0xFFE6E6EA),
    text: Color(0xFF1D1D1F),
    text2: Color(0xFF48484A),
    text3: Color(0xFF8A8A8E),
    separator: Color(0xFFDCDCE0),
    accent: Color(0xFF2563EB),
    selection: Color(0xFF2563EB),
    claudeToGpt: Color(0xFF2A78D6),
    gptToClaude: Color(0xFFEB6834),
    bridge: Color(0xFF1BAF7A),
    good: Color(0xFF0CA30C),
    warning: Color(0xFFB77900),
    warningMark: Color(0xFFFAB219),
    critical: Color(0xFFD03B3B),
    claude: Color(0xFFC15F3C),
    gpt: Color(0xFF0F766E),
    brand: Color(0xFF2563EB),
  );

  Color app(String? a) => a == 'claude'
      ? claude
      : a == 'codex'
      ? gpt
      : brand;

  @override
  Tokens copyWith() => this;

  @override
  Tokens lerp(ThemeExtension<Tokens>? other, double t) => t < 0.5 ? this : (other as Tokens? ?? this);
}

extension TokensX on BuildContext {
  Tokens get t => Theme.of(this).extension<Tokens>()!;
}

const radiusCard = 12.0;
const radiusControl = 7.0;

ThemeData buildTheme(Brightness b) {
  final tk = b == Brightness.dark ? Tokens.dark : Tokens.light;
  final base = ThemeData(
    brightness: b,
    useMaterial3: true,
    fontFamily: 'Inter',
    scaffoldBackgroundColor: tk.window,
    colorScheme: ColorScheme.fromSeed(seedColor: tk.accent, brightness: b, surface: tk.card, primary: tk.accent),
    splashFactory: NoSplash.splashFactory,
    hoverColor: tk.hover,
    dividerColor: tk.separator,
    dividerTheme: DividerThemeData(color: tk.separator, thickness: 1, space: 1),
    tooltipTheme: TooltipThemeData(
      waitDuration: const Duration(milliseconds: 500),
      decoration: BoxDecoration(color: b == Brightness.dark ? const Color(0xFF3A3A3C) : const Color(0xFF2C2C2E), borderRadius: BorderRadius.circular(6)),
      textStyle: const TextStyle(color: Colors.white, fontSize: 12, fontFamily: 'Inter'),
    ),
    scrollbarTheme: ScrollbarThemeData(
      thickness: WidgetStateProperty.all(6),
      radius: const Radius.circular(3),
      thumbColor: WidgetStateProperty.all(tk.text3.withValues(alpha: 0.4)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      isDense: true,
      filled: true,
      fillColor: b == Brightness.dark ? const Color(0xFF2A2A2C) : Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
      hintStyle: TextStyle(color: tk.text3, fontSize: 13),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(radiusControl),
        borderSide: BorderSide(color: tk.cardBorder),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(radiusControl),
        borderSide: BorderSide(color: tk.cardBorder),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(radiusControl),
        borderSide: BorderSide(color: tk.accent, width: 2),
      ),
    ),
    extensions: [tk],
  );
  return base.copyWith(
    textTheme: base.textTheme.apply(bodyColor: tk.text, displayColor: tk.text, fontFamily: 'Inter'),
  );
}

/// Type scale matching the macOS app.
class T {
  static const caption = TextStyle(fontSize: 11.5, fontWeight: FontWeight.w500);
  static const caption2 = TextStyle(fontSize: 10.5, fontWeight: FontWeight.w500);
  static const callout = TextStyle(fontSize: 13);
  static const calloutStrong = TextStyle(fontSize: 13, fontWeight: FontWeight.w600);
  static const body = TextStyle(fontSize: 13.5);
  static const headline = TextStyle(fontSize: 14, fontWeight: FontWeight.w600);
  static const title3 = TextStyle(fontSize: 17, fontWeight: FontWeight.w600);
  static const kpi = TextStyle(fontSize: 26, fontWeight: FontWeight.w700, letterSpacing: -0.5, fontFeatures: [FontFeature.tabularFigures()]);
  static const mono = TextStyle(fontFamily: 'monospace', fontFamilyFallback: ['Menlo', 'Consolas', 'DejaVu Sans Mono'], fontSize: 12);
}
