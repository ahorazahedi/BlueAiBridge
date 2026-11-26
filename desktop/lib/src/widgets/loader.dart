// Loads data for a page: on first show, when `reloadKey` changes, and
// (debounced) whenever the broker reports a change.

import 'package:material_ui/material_ui.dart';
import 'package:provider/provider.dart';

import '../state/app_state.dart';

class Loader<D> extends StatefulWidget {
  final Object? reloadKey;
  final Future<D> Function() load;
  final Widget Function(BuildContext context, D? data, Object? error, VoidCallback reload) builder;
  final bool live;
  const Loader({super.key, this.reloadKey, required this.load, required this.builder, this.live = true});

  @override
  State<Loader<D>> createState() => _LoaderState<D>();
}

class _LoaderState<D> extends State<Loader<D>> {
  D? data;
  Object? error;
  int _seq = 0;
  int _tick = -1;
  Object? _key;

  Future<void> _run() async {
    final my = ++_seq;
    try {
      final d = await widget.load();
      if (!mounted || my != _seq) return;
      setState(() {
        data = d;
        error = null;
      });
    } catch (e) {
      if (!mounted || my != _seq) return;
      setState(() => error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tick = widget.live ? context.select<AppState, int>((a) => a.tick) : 0;
    if (tick != _tick || widget.reloadKey != _key) {
      _tick = tick;
      _key = widget.reloadKey;
      WidgetsBinding.instance.addPostFrameCallback((_) => _run());
    }
    return widget.builder(context, data, error, _run);
  }
}
