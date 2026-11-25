import { useEffect, useMemo, useRef, useState } from "react";
import { navigate, useApi, useConnection, useRoute, useStoredState } from "./lib/hooks";
import type { LinkRow, Summary } from "./lib/api";
import { Badge, Segmented, ToastProvider } from "./components/ui";
import { IActivity, IBook, IBridge, IChat, IClients, IHealth, IMoon, IOverview, ISearch, ISettings, ISun, ITraffic } from "./components/icons";
import { Overview } from "./views/Overview";
import { Conversations } from "./views/Conversations";
import { Traffic } from "./views/Traffic";
import { Clients } from "./views/Clients";
import { Chats } from "./views/Chats";
import { Health } from "./views/Health";
import { Settings } from "./views/Settings";
import { Activity } from "./views/Activity";
import { duration } from "./lib/format";

const NAV = [
  { id: "overview", label: "Overview", icon: IOverview, group: "Monitor" },
  { id: "conversations", label: "Conversations", icon: IChat, group: "Monitor" },
  { id: "traffic", label: "Traffic", icon: ITraffic, group: "Monitor" },
  { id: "activity", label: "Activity", icon: IActivity, group: "Monitor" },
  { id: "chats", label: "Chat library", icon: IBook, group: "Monitor" },
  { id: "clients", label: "Clients & install", icon: IClients, group: "Manage" },
  { id: "health", label: "Health", icon: IHealth, group: "Manage" },
  { id: "settings", label: "Settings", icon: ISettings, group: "Manage" },
] as const;

const RANGED = new Set(["overview", "traffic"]);

export function App() {
  const route = useRoute();
  const conn = useConnection();
  const [theme, setTheme] = useStoredState<"system" | "light" | "dark">("theme", "system");
  const [range, setRange] = useStoredState<string>("range", "24h");
  const [palette, setPalette] = useState(false);
  const summary = useApi<Summary>("/api/summary?range=24h", { live: (e) => e.type.startsWith("link.") || e.type.startsWith("message."), interval: 60_000 });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const view = NAV.some((n) => n.id === route.view) ? route.view : "overview";
  const current = NAV.find((n) => n.id === view)!;
  useEffect(() => {
    document.title = `${current.label} · BlueAIBridge`;
  }, [current.label]);

  return (
    <ToastProvider>
      <div className="app">
        <aside className="sidebar" aria-label="Navigation">
          <div className="brand">
            <div className="brand-mark">
              <IBridge size={18} />
            </div>
            <div>
              <div className="brand-name">BlueAIBridge</div>
              <div className="brand-sub">Claude ⇄ ChatGPT</div>
            </div>
          </div>
          {(["Monitor", "Manage"] as const).map((g) => (
            <div key={g}>
              <div className="nav-label">{g}</div>
              {NAV.filter((n) => n.group === g).map((n) => (
                <a key={n.id} href={`#/${n.id}`} className={`nav-item ${view === n.id ? "active" : ""}`} aria-current={view === n.id ? "page" : undefined}>
                  <n.icon size={16} />
                  {n.label}
                  {n.id === "conversations" && summary.data && summary.data.openLinks > 0 && <span className="count">{summary.data.openLinks}</span>}
                </a>
              ))}
            </div>
          ))}
          <div className="sidebar-foot">
            <div className="row">
              <span className={`dot ${conn === "live" ? "live" : conn === "down" ? "bad" : "off"}`} />
              {conn === "live" ? "Broker connected" : conn === "down" ? "Broker unreachable" : "Connecting…"}
            </div>
            {summary.data && (
              <div>
                v{summary.data.version} · up {duration(Date.now() - summary.data.startedAt)}
              </div>
            )}
            <div className="row">
              <Segmented
                value={theme}
                onChange={setTheme}
                label="Theme"
                options={[
                  { value: "light", label: <ISun size={13} /> },
                  { value: "system", label: "Auto" },
                  { value: "dark", label: <IMoon size={13} /> },
                ]}
              />
            </div>
          </div>
        </aside>
        <main className="main">
          <header className="topbar">
            <h1>{current.label}</h1>
            {route.param && <span className="crumb mono">/ {route.param}</span>}
            <div className="spacer" />
            {RANGED.has(view) && (
              <Segmented value={range} onChange={setRange} label="Time range" options={["1h", "6h", "24h", "7d", "30d"].map((r) => ({ value: r, label: r }))} />
            )}
            <button className="btn" onClick={() => setPalette(true)} aria-label="Search">
              <ISearch size={14} /> Search <kbd>⌘K</kbd>
            </button>
            {conn === "down" && <Badge tone="critical">Offline</Badge>}
          </header>
          <div className="content">
            {view === "overview" && <Overview range={range} />}
            {view === "conversations" && <Conversations selected={route.param} />}
            {view === "traffic" && <Traffic range={range} />}
            {view === "activity" && <Activity />}
            {view === "chats" && <Chats selected={route.param} />}
            {view === "clients" && <Clients />}
            {view === "health" && <Health />}
            {view === "settings" && <Settings />}
          </div>
        </main>
      </div>
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
    </ToastProvider>
  );
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const links = useApi<{ links: LinkRow[] }>(q.length >= 2 ? `/api/links?limit=8&q=${encodeURIComponent(q)}` : null);
  useEffect(() => input.current?.focus(), []);
  const items = useMemo(() => {
    const nav = NAV.filter((n) => n.label.toLowerCase().includes(q.toLowerCase())).map((n) => ({ key: n.id, label: `Go to ${n.label}`, icon: <n.icon size={15} />, run: () => navigate(n.id) }));
    const ls = (links.data?.links ?? []).map((l) => ({ key: l.id, label: `${l.id} — ${l.title}`, icon: <IChat size={15} />, run: () => navigate("conversations", l.id) }));
    return [...ls, ...nav];
  }, [q, links.data]);
  const go = (i: number) => {
    items[i]?.run();
    onClose();
  };
  return (
    <>
      <div className="overlay" onMouseDown={onClose} />
      <div className="palette" role="dialog" aria-label="Search">
        <input
          ref={input}
          value={q}
          placeholder="Jump to a page or search conversations…"
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(items.length - 1, s + 1)));
            if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(0, s - 1)));
            if (e.key === "Enter") go(sel);
          }}
        />
        <div className="items">
          {items.map((it, i) => (
            <div key={it.key} className={`item ${i === sel ? "on" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => go(i)}>
              {it.icon}
              <span className="trunc">{it.label}</span>
            </div>
          ))}
          {!items.length && <div className="muted small" style={{ padding: 12 }}>Nothing found.</div>}
        </div>
      </div>
    </>
  );
}
