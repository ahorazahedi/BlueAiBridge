import { useState } from "react";
import { api, type ClientInfo, type InstallResult, type InstallStatus, type InstallTarget, type AutoState } from "../lib/api";
import { navigate, useApi, useNow } from "../lib/hooks";
import { AppBadge, Badge, Card, Confirm, Empty, ErrorBox, Skeleton, useToast } from "../components/ui";
import { ago } from "../lib/format";
import { ClaudeMark, GptMark, IBolt, ICheck, ICheckCircle, IAlert, IClients, IDownload, IMenu, ITrash, IXCircle, IShield } from "../components/icons";

type Action = { target: string; action: "install" | "uninstall"; label: string };

const ICONS: Record<string, React.ReactElement> = {
  claude: <ClaudeMark size={20} />,
  codex: <GptMark size={20} />,
  service: <IBolt size={20} />,
  menubar: <IMenu size={20} />,
};
const GRADIENT: Record<string, string> = {
  claude: "linear-gradient(135deg,#d97757,#b4532f)",
  codex: "linear-gradient(135deg,#10a37f,#0b6e57)",
  service: "linear-gradient(135deg,#3b82f6,#1d4ed8)",
  menubar: "linear-gradient(135deg,#64748b,#334155)",
};
const DESC: Record<string, string> = {
  claude: "MCP server (user scope), 7 hooks and the tool permission, for Claude Desktop's Code tab and the Claude Code CLI.",
  codex: "MCP server in ~/.codex/config.toml and 3 hooks in ~/.codex/hooks.json, for ChatGPT Desktop and the Codex CLI.",
  service: "Keeps the broker and this dashboard running and restarts them if they stop: a LaunchAgent on macOS, a systemd user service on Linux, a logon task on Windows.",
  desktop: "The BlueAIBridge desktop app for Windows and Linux: this whole dashboard in its own window, plus a tray icon with live status. Starts at login.",
  menubar: "The native macOS app: this whole dashboard in its own window, plus a menu-bar icon with live status. Starts at login.",
};

export function Clients() {
  const st = useApi<InstallStatus>("/api/install", { live: (e) => e.type.startsWith("install.") });
  const clients = useApi<{ clients: (ClientInfo & { listening: boolean | null; auto: AutoState | null })[] }>("/api/clients", { live: (e) => e.type.startsWith("client.") || e.type.startsWith("auto."), interval: 30_000 });
  const [pending, setPending] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InstallResult | null>(null);
  const toast = useToast();
  const now = useNow();

  const run = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await api<InstallResult>("/api/install", { body: { target: pending.target, action: pending.action } });
      setResult(r);
      toast({ tone: r.ok ? "good" : "error", title: r.ok ? `${pending.label} done` : `${pending.label} finished with problems`, body: r.ok && pending.action === "install" ? "Restart Claude Desktop and ChatGPT Desktop to load it." : undefined });
      setPending(null);
      void st.reload();
    } catch (e) {
      toast({ tone: "error", title: `${pending.label} failed`, body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Clients & installation</h2>
          <p>Install BlueAIBridge into each app, check what is detected on this Mac, and see every chat that has used the bridge.</p>
        </div>
        <div className="actions">
          <button className="btn danger" onClick={() => setPending({ target: "all", action: "uninstall", label: "Uninstall everything" })}>
            <ITrash size={14} /> Uninstall all
          </button>
          <button className="btn primary" onClick={() => setPending({ target: "all", action: "install", label: "Install everything" })}>
            <IDownload size={14} /> Install all
          </button>
        </div>
      </div>
      {st.error && <ErrorBox error={st.error} retry={st.reload} />}
      {st.data && (
        <div className="notice" style={{ background: st.data.runtime.installed && st.data.runtime.upToDate ? "var(--good-soft)" : "var(--warning-soft)" }}>
          {st.data.runtime.installed && st.data.runtime.upToDate ? <ICheckCircle style={{ color: "var(--good)" }} /> : <IAlert style={{ color: "var(--warning)" }} />}
          <div style={{ flex: 1 }}>
            <strong>Runtime {st.data.runtime.installed ? `v${st.data.runtime.version}` : "not installed"}</strong>
            <span className="muted"> · {st.data.runtime.path}</span>
            {st.data.runtime.installed && !st.data.runtime.upToDate && <div className="small">This build is v{st.data.version}: reinstall to update every client.</div>}
          </div>
          <button className="btn sm" onClick={() => setPending({ target: "runtime", action: "install", label: "Update runtime" })}>
            {st.data.runtime.installed ? "Reinstall" : "Install"}
          </button>
        </div>
      )}
      <div className="grid halves">
        {!st.data && !st.error && [0, 1, 2, 3].map((i) => <Card key={i}><Skeleton h={140} /></Card>)}
        {st.data?.targets.map((t) => <TargetCard key={t.id} t={t} onAction={setPending} />)}
      </div>
      {result && (
        <Card title={`Last ${result.action}`} sub={result.backupDir ? `Backups: ${result.backupDir}` : undefined} right={<button className="btn sm ghost" onClick={() => setResult(null)}>Dismiss</button>}>
          <div className="steps">
            {result.steps.map((s, i) => (
              <div className="s" key={i}>
                {s.ok ? <ICheckCircle size={16} style={{ color: "var(--good)", flex: "none" }} /> : <IXCircle size={16} style={{ color: "var(--critical)", flex: "none" }} />}
                <span>
                  <strong>{s.target}</strong> — {s.message}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card title="Chats seen by the bridge" sub="Every Claude session and ChatGPT thread that used BlueAIBridge" flush>
        {clients.error && <ErrorBox error={clients.error} retry={clients.reload} />}
        {clients.data?.clients.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Chat</th>
                  <th>Where</th>
                  <th>Folder</th>
                  <th>Listening</th>
                  <th>Auto mode</th>
                  <th className="num">Last seen</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {clients.data.clients.map((c) => (
                  <tr key={`${c.app}:${c.id}`}>
                    <td>
                      <div className="row">
                        <AppBadge e={c} />
                        {c.title && <span className="trunc" style={{ maxWidth: 220 }}>{c.title}</span>}
                      </div>
                    </td>
                    <td>
                      <Badge tone="outline">{c.surface}</Badge>
                    </td>
                    <td className="mono small trunc" style={{ maxWidth: 240 }} title={c.cwd ?? ""}>
                      {c.cwd ?? "—"}
                    </td>
                    <td>{c.listening == null ? <span className="muted">n/a</span> : c.listening ? <Badge tone="good"><span className="dot live" style={{ width: 6, height: 6 }} /> listening</Badge> : <Badge tone="neutral">not open</Badge>}</td>
                    <td>{c.auto?.on ? <Badge tone="info"><IBolt size={12} /> {c.auto.everyTurn ? "every turn" : "key moments"}</Badge> : <span className="muted">off</span>}</td>
                    <td className="num muted">{ago(c.lastSeen, now)}</td>
                    <td>
                      <button className="btn sm ghost" onClick={() => navigate("chats", `${c.app}:${c.id}`)}>
                        Read chat
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          clients.data && <Empty icon={<IClients />} title="No chats yet">Chats show up here the first time they use a BlueAIBridge tool.</Empty>
        )}
      </Card>
      <Confirm
        open={!!pending}
        title={pending ? `${pending.label}?` : ""}
        body={
          pending?.action === "uninstall" ? (
            <>
              This removes BlueAIBridge from {pending.target === "all" ? "every app, the background service and the menu-bar app" : <strong>{pending.target}</strong>}. Every file it changes is backed up first to <code>~/.blueaibridge/backups</code>. Your conversation history stays.
              {pending.target === "all" || pending.target === "service" ? " The dashboard stops with the background service." : ""}
            </>
          ) : (
            <>
              This changes your app configuration{pending?.target === "all" ? " for Claude Code, ChatGPT/Codex, the background service and the menu-bar app" : ` for ${pending?.target}`}. Every file is backed up first. Restart Claude Desktop and ChatGPT Desktop afterwards; ChatGPT asks you to trust the new hooks once.
            </>
          )
        }
        confirmLabel={pending?.label ?? ""}
        danger={pending?.action === "uninstall"}
        busy={busy}
        onConfirm={run}
        onClose={() => !busy && setPending(null)}
      />
    </div>
  );
}

function TargetCard({ t, onAction }: { t: InstallTarget; onAction: (a: Action) => void }) {
  const details = Object.entries(t.details).filter(([k]) => !["plist", "app"].includes(k));
  return (
    <div className="card client-card">
      <div className="head">
        <div className="logo" style={{ background: GRADIENT[t.id] }}>
          {ICONS[t.id]}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row">
            <strong style={{ fontSize: 15 }}>{t.name}</strong>
            {t.installed ? (
              <Badge tone="good">
                <ICheck size={12} /> Installed
              </Badge>
            ) : t.partial ? (
              <Badge tone="warning">
                <IAlert size={12} /> Partly installed
              </Badge>
            ) : (
              <Badge tone="neutral">Not installed</Badge>
            )}
          </div>
          <div className="muted small">{DESC[t.id]}</div>
        </div>
      </div>
      {t.clients.length > 0 && (
        <div className="clients">
          {t.clients.map((c) => (
            <div className="c" key={c.id} title={c.path ?? ""}>
              <span className={`dot ${c.detected ? "live" : "off"}`} style={c.detected ? undefined : { opacity: 0.5 }} />
              <span>{c.name}</span>
              <span className="muted small" style={{ marginLeft: "auto" }}>
                {c.detected ? "detected" : "not found on this Mac"}
              </span>
            </div>
          ))}
        </div>
      )}
      {details.length > 0 && (
        <div className="row wrap small">
          {details.map(([k, v]) => (
            <Badge key={k} tone={v === false ? "warning" : "outline"}>
              {k}: {String(v ?? "—")}
            </Badge>
          ))}
        </div>
      )}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        {(t.installed || t.partial) && (
          <button className="btn sm danger" onClick={() => onAction({ target: t.id, action: "uninstall", label: `Uninstall ${t.name}` })}>
            <ITrash size={13} /> Uninstall
          </button>
        )}
        <button className="btn sm primary" onClick={() => onAction({ target: t.id, action: "install", label: `${t.installed ? "Reinstall" : "Install"} ${t.name}` })}>
          {t.installed ? <IShield size={13} /> : <IDownload size={13} />} {t.installed ? "Reinstall" : "Install"}
        </button>
      </div>
    </div>
  );
}
