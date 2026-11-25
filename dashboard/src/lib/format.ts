import type { Endpoint } from "./api";

export function bytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function num(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat(undefined, { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);
}

export function duration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m ${Math.round(s % 60)}s`;
  const h = m / 60;
  return `${Math.floor(h)}h ${Math.round(m % 60)}m`;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
export function ago(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return "—";
  const d = (ts - now) / 1000;
  const abs = Math.abs(d);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(d / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(d / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(d / 86400), "day");
  return new Date(ts).toLocaleDateString();
}

export const time = (ts: number | null | undefined) => (ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");
export const dateTime = (ts: number | null | undefined) => (ts ? new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

export const appLabel = (app: string | undefined | null) => (app === "claude" ? "Claude" : app === "codex" ? "ChatGPT" : "BlueAIBridge");
export const shortId = (id: string) => (id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id);
export const epLabel = (e: Endpoint | null | undefined) => (e ? `${appLabel(e.app)} · ${shortId(e.id)}` : "BlueAIBridge");

export function pct(a: number, b: number): string {
  if (!b) return "0%";
  return `${Math.round((a / b) * 100)}%`;
}
