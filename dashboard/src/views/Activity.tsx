import { useEffect, useMemo, useState } from "react";
import type { BridgeEvent } from "../lib/api";
import { api } from "../lib/api";
import { onBridgeEvent, navigate, useConnection } from "../lib/hooks";
import { Card, Empty, Segmented, Badge } from "../components/ui";
import { time, bytes, appLabel } from "../lib/format";
import { IActivity, IAlert, ICheckCircle, IChat, IClock, ILink, IPause, IPlay, IXCircle, IBolt, ISettings, IUsers, IArrowRight, IDownload } from "../components/icons";

const GROUPS: Record<string, (t: string) => boolean> = {
  all: () => true,
  messages: (t) => t.startsWith("message.") || t.startsWith("review.") || t.startsWith("ask."),
  delivery: (t) => t.startsWith("delivery.") || t.startsWith("app."),
  links: (t) => t.startsWith("link.") || t.startsWith("auto."),
  errors: (t) => /failed|error|stop_failure|retry/.test(t),
  system: (t) => t.startsWith("broker.") || t.startsWith("install.") || t.startsWith("client.") || t.startsWith("rules.") || t.startsWith("maintenance.") || t.startsWith("chat."),
};

export function describe(e: BridgeEvent): { icon: React.ReactElement; text: React.ReactNode; tone: string } {
  const d = e.data as Record<string, string | number | boolean | null>;
  const who = (k: string | null | undefined) => (k ? `${appLabel(k.split(":")[0])}` : "BlueAIBridge");
  switch (e.type) {
    case "message.created":
      return { icon: <IChat size={14} />, tone: "var(--text-2)", text: <>{who(e.actor)} → {who(d.to as string)}: new {String(d.kind)} {e.messageId} {d.round && Number(d.round) > 1 ? `(round ${d.round})` : ""}</> };
    case "review.answered":
      return d.decision === "approved"
        ? { icon: <ICheckCircle size={14} />, tone: "var(--good)", text: <>{who(e.actor)} approved {e.linkId} (round {String(d.round)}{d.nits ? `, ${d.nits} nits` : ""})</> }
        : d.decision === "changes_requested"
          ? { icon: <IAlert size={14} />, tone: "var(--warning)", text: <>{who(e.actor)} requested changes on {e.linkId}: {String(d.blocking)} must-fix</> }
          : { icon: <IChat size={14} />, tone: "var(--text-2)", text: <>{who(e.actor)} answered {e.linkId}</> };
    case "ask.answered":
      return { icon: <IChat size={14} />, tone: "var(--text-2)", text: <>{who(e.actor)} answered a question ({e.linkId})</> };
    case "delivery.started":
      return { icon: <IArrowRight size={14} />, tone: "var(--brand)", text: <>Sending {e.messageId} to {who(e.actor)} ({String(d.channel)})</> };
    case "delivery.done":
      return { icon: <ICheckCircle size={14} />, tone: "var(--good)", text: <>Delivered {e.messageId} to {who(e.actor)} ({String(d.channel)})</> };
    case "delivery.deferred":
      return { icon: <IClock size={14} />, tone: "var(--warning)", text: <>{e.messageId} waits: {String(d.reason)}</> };
    case "delivery.retry":
      return { icon: <IClock size={14} />, tone: "var(--warning)", text: <>Retrying {e.messageId} (attempt {String(d.attempts)}): {String(d.error).slice(0, 120)}</> };
    case "delivery.failed":
      return { icon: <IXCircle size={14} />, tone: "var(--critical)", text: <>Delivery of {e.messageId} failed: {String(d.error).slice(0, 160)}</> };
    case "link.created":
      return { icon: <ILink size={14} />, tone: "var(--brand)", text: <>{who(e.actor)} opened {e.linkId} ({String(d.kind)}{d.reviewKind ? `/${d.reviewKind}` : ""}, {String(d.delivery)}){d.title ? `: ${String(d.title).slice(0, 80)}` : ""}</> };
    case "link.joined":
      return { icon: <IUsers size={14} />, tone: "var(--brand)", text: <>{who(e.actor)} joined {e.linkId} with a code</> };
    case "link.closed":
      return { icon: <ILink size={14} />, tone: "var(--text-3)", text: <>{e.linkId} closed: {String(d.reason)}</> };
    case "auto.on":
      return { icon: <IBolt size={14} />, tone: "var(--brand)", text: <>{who(e.actor)} turned auto mode on ({d.everyTurn ? "every turn" : "key moments"})</> };
    case "auto.off":
      return { icon: <IBolt size={14} />, tone: "var(--text-3)", text: <>{who(e.actor)} turned auto mode off</> };
    case "auto.guard":
      return { icon: <IAlert size={14} />, tone: "var(--warning)", text: <>End-of-turn check stopped {who(e.actor)}: unapproved changes</> };
    case "client.seen":
      return { icon: <IUsers size={14} />, tone: "var(--text-3)", text: <>New chat seen: {who(e.actor)} ({String(d.surface)})</> };
    case "client.stop_failure":
      return { icon: <IXCircle size={14} />, tone: "var(--critical)", text: <>{who(e.actor)} stopped with an API error</> };
    case "client.permission_prompt":
      return { icon: <IAlert size={14} />, tone: "var(--warning)", text: <>{who(e.actor)} waits for a tool approval</> };
    case "broker.started":
      return { icon: <IBolt size={14} />, tone: "var(--good)", text: <>Broker started (pid {String(d.pid)}, v{String(d.version)})</> };
    case "broker.error":
      return { icon: <IXCircle size={14} />, tone: "var(--critical)", text: <>Broker error in {String(d.what)}: {String(d.error).slice(0, 160)}</> };
    default:
      if (e.type.startsWith("install."))
        return { icon: <ISettings size={14} />, tone: "var(--text-2)", text: <>{e.type === "install.install" ? "Installed" : "Uninstalled"} {String(d.target)} {d.ok ? "" : "(with problems)"}</> };
      return { icon: <IActivity size={14} />, tone: "var(--text-3)", text: <>{e.type}{e.linkId ? ` · ${e.linkId}` : ""}{e.messageId ? ` · ${e.messageId}` : ""}</> };
  }
}

export function EventLine({ e, compact, fresh }: { e: BridgeEvent; compact?: boolean; fresh?: boolean }) {
  const { icon, text, tone } = describe(e);
  return (
    <div className={`f ${fresh ? "new" : ""}`} style={compact ? { gridTemplateColumns: "62px 18px 1fr" } : undefined}>
      <span className="when">{time(e.ts)}</span>
      <span style={{ color: tone, display: "grid", placeItems: "center" }}>{icon}</span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: compact ? "nowrap" : "normal" }}>
        {text}
        {e.linkId && !compact && (
          <button className="btn sm ghost" style={{ marginLeft: 6, height: 22 }} onClick={() => navigate("conversations", e.linkId)}>
            open
          </button>
        )}
      </span>
      {!compact && <span className="muted small tabular">{e.bytes ? bytes(e.bytes) : ""}</span>}
    </div>
  );
}

export function Activity() {
  const [events, setEvents] = useState<BridgeEvent[]>([]);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [paused, setPaused] = useState(false);
  const [group, setGroup] = useState("all");
  const conn = useConnection();
  useEffect(() => {
    void api<{ events: BridgeEvent[] }>("/api/events?limit=400").then((r) => setEvents(r.events));
  }, []);
  useEffect(() => {
    if (paused) return;
    const off = onBridgeEvent((e) => {
      setEvents((xs) => (xs.some((x) => x.id === e.id) ? xs : [e, ...xs].slice(0, 2000)));
      setFresh((s) => new Set(s).add(e.id));
      setTimeout(() => setFresh((s) => {
        const n = new Set(s);
        n.delete(e.id);
        return n;
      }), 1300);
    });
    return () => {
      off();
    };
  }, [paused]);
  const shown = useMemo(() => events.filter((e) => GROUPS[group](e.type)), [events, group]);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Activity</h2>
          <p>Every event the bridge records, streamed live.</p>
        </div>
        <div className="actions">
          <Badge tone={conn === "live" ? "good" : conn === "down" ? "critical" : "warning"}>
            <span className={`dot ${conn === "live" ? "live" : conn === "down" ? "bad" : "off"}`} /> {conn === "live" ? "Live" : conn === "down" ? "Disconnected" : "Connecting"}
          </Badge>
          <Segmented value={group} onChange={setGroup} options={Object.keys(GROUPS).map((g) => ({ value: g, label: g[0].toUpperCase() + g.slice(1) }))} label="Filter events" />
          <button className="btn" onClick={() => setPaused(!paused)}>
            {paused ? <IPlay size={14} /> : <IPause size={14} />} {paused ? "Resume" : "Pause"}
          </button>
          <a className="btn" href="/api/export?what=events&format=csv&range=7d">
            <IDownload size={14} /> Export
          </a>
        </div>
      </div>
      <Card flush>
        {shown.length ? (
          <div className="feed">
            {shown.slice(0, 600).map((e) => (
              <EventLine key={e.id} e={e} fresh={fresh.has(e.id)} />
            ))}
          </div>
        ) : (
          <Empty icon={<IActivity />} title="No events yet">
            Events appear here as chats use the bridge.
          </Empty>
        )}
      </Card>
    </div>
  );
}
