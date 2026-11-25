import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, type BridgeEvent } from "./api";

// ---------------------------------------------------------------------
// live events (one shared EventSource for the whole app)
// ---------------------------------------------------------------------

type Listener = (e: BridgeEvent) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;
let connState: "connecting" | "live" | "down" = "connecting";
const connSubs = new Set<() => void>();
let lastId = 0;
const recent: BridgeEvent[] = [];

function setConn(s: typeof connState) {
  if (connState === s) return;
  connState = s;
  for (const f of connSubs) f();
}

function connect() {
  if (source) return;
  source = new EventSource(`/api/stream${lastId ? `?afterId=${lastId}` : ""}`, { withCredentials: true });
  source.onopen = () => setConn("live");
  source.onerror = () => {
    setConn("down");
    source?.close();
    source = null;
    setTimeout(connect, 2500);
  };
  source.addEventListener("bridge", (ev) => {
    const e = JSON.parse((ev as MessageEvent).data) as BridgeEvent;
    lastId = Math.max(lastId, e.id);
    recent.unshift(e);
    if (recent.length > 500) recent.pop();
    for (const l of listeners) l(e);
  });
}

export function onBridgeEvent(fn: Listener) {
  connect();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function recentEvents() {
  return recent;
}

export function useConnection() {
  connect();
  return useSyncExternalStore(
    (f) => {
      connSubs.add(f);
      return () => {
        connSubs.delete(f);
      };
    },
    () => connState,
  );
}

/** Call `fn` (debounced) whenever a live event matches `filter`. */
export function useLiveRefresh(fn: () => void, filter: (e: BridgeEvent) => boolean = () => true, delay = 400) {
  const ref = useRef(fn);
  ref.current = fn;
  const fref = useRef(filter);
  fref.current = filter;
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = onBridgeEvent((e) => {
      if (!fref.current(e)) return;
      if (t) clearTimeout(t);
      t = setTimeout(() => ref.current(), delay);
    });
    return () => {
      off();
      if (t) clearTimeout(t);
    };
  }, [delay]);
}

// ---------------------------------------------------------------------
// data fetching
// ---------------------------------------------------------------------

export function useApi<T>(path: string | null, opts: { live?: (e: BridgeEvent) => boolean; interval?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (my === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (my === seq.current) setError(e as Error);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);
  useEffect(() => {
    if (!opts.interval) return;
    const t = setInterval(() => void load(), opts.interval);
    return () => clearInterval(t);
  }, [load, opts.interval]);
  useLiveRefresh(() => void load(), opts.live ?? (() => false));
  return { data, error, loading, reload: load, setData };
}

// ---------------------------------------------------------------------
// hash routing: #/conversations/L12
// ---------------------------------------------------------------------

function readHash() {
  const h = window.location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = h.split("?");
  const parts = path.split("/").filter(Boolean);
  return { view: parts[0] ?? "overview", param: parts[1] ?? null, query: new URLSearchParams(query) };
}

export function useRoute() {
  const [route, setRoute] = useState(readHash);
  useEffect(() => {
    const on = () => setRoute(readHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function navigate(view: string, param?: string | null) {
  window.location.hash = `/${view}${param ? `/${param}` : ""}`;
}

// ---------------------------------------------------------------------
// misc
// ---------------------------------------------------------------------

export function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useStoredState<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(`bab:${key}`);
      return s ? (JSON.parse(s) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T) => {
      setV(next);
      try {
        localStorage.setItem(`bab:${key}`, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
    },
    [key],
  );
  return [v, set] as const;
}
