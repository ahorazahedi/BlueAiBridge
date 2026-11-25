import { useEffect, useMemo, useState } from "react";
import type { Message, Summary } from "../lib/api";
import { navigate, useApi, useNow } from "../lib/hooks";
import { AppBadge, Badge, Card, DecisionBadge, Drawer, Empty, ErrorBox, Kpi, Skeleton, StateBadge, CopyButton } from "../components/ui";
import { Markdown } from "../components/Markdown";
import { ago, bytes, duration, num } from "../lib/format";
import { IArrowRight, IDownload, ISearch, ITraffic, IData, IClock, IAlert } from "../components/icons";
import { BarList } from "../components/charts";
import { channelLabel } from "./Overview";

const PAGE = 100;
const RANGE_MS: Record<string, number> = { "1h": 3600_000, "6h": 6 * 3600_000, "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 };

export function Traffic({ range }: { range: string }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [state, setState] = useState("");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Message | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q);
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const since = useMemo(() => Date.now() - RANGE_MS[range], [range]);
  const list = useApi<{ messages: Message[] }>(`/api/messages?since=${since}&limit=${PAGE + 1}&offset=${page * PAGE}&state=${state}&kind=${kind}&q=${encodeURIComponent(debounced)}`, {
    live: (e) => e.type.startsWith("message.") || e.type.startsWith("delivery.") || e.type.startsWith("review."),
  });
  const summary = useApi<Summary>(`/api/summary?range=${range}`, { live: (e) => e.type.startsWith("message.") });
  const now = useNow();
  const rows = list.data?.messages.slice(0, PAGE) ?? [];
  const more = (list.data?.messages.length ?? 0) > PAGE;
  const s = summary.data;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Traffic</h2>
          <p>Every message that crossed the bridge in the last {range}: direction, channel, size, latency and outcome.</p>
        </div>
        <div className="actions">
          <a className="btn" href={`/api/export?what=messages&format=csv&range=${range}`}>
            <IDownload size={14} /> CSV
          </a>
          <a className="btn" href={`/api/export?what=messages&format=json&range=${range}`}>
            <IDownload size={14} /> JSON
          </a>
        </div>
      </div>
      <div className="grid kpis four">
        <Kpi label="Messages" icon={<ITraffic size={14} />} value={s ? num(s.messages) : <Skeleton h={28} w={60} />} />
        <Kpi label="Bytes" icon={<IData size={14} />} value={s ? bytes(s.bytes) : <Skeleton h={28} w={60} />} hint={s && s.messages ? `${bytes(Math.round(s.bytes / s.messages))} per message` : " "} />
        <Kpi label="Avg delivery" icon={<IClock size={14} />} value={s ? duration(s.avgDeliveryMs) : <Skeleton h={28} w={60} />} />
        <Kpi label="Failed" icon={<IAlert size={14} />} value={s ? num(s.failed) : <Skeleton h={28} w={60} />} />
      </div>
      <div className="grid halves">
        <Card title="By direction">
          <BarList
            format={bytes}
            rows={(s?.byDirection ?? []).map((d) => ({
              label: (
                <span className="row">
                  {d.from === "bridge" ? "BlueAIBridge" : d.from === "claude" ? "Claude" : "ChatGPT"} <IArrowRight size={12} /> {d.to === "claude" ? "Claude" : d.to === "codex" ? "ChatGPT" : "pending"}
                </span>
              ),
              value: d.bytes,
              sub: `${d.messages} msgs`,
              color: d.from === "claude" ? "var(--series-claude)" : d.from === "codex" ? "var(--series-gpt)" : "var(--series-bridge)",
            }))}
          />
        </Card>
        <Card title="By channel">
          <BarList
            format={bytes}
            rows={(s?.byChannel ?? []).filter((c) => c.channel !== "none").map((c) => ({ label: channelLabel(c.channel), value: c.bytes, sub: `${c.messages} msgs`, color: "var(--series-claude)" }))}
          />
        </Card>
      </div>
      <Card
        flush
        title="Messages"
        right={
          <>
            <div className="search" style={{ width: 260 }}>
              <ISearch size={14} />
              <input className="input" placeholder="Search content or id…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search messages" />
            </div>
            <select className="select" value={kind} onChange={(e) => (setKind(e.target.value), setPage(0))} aria-label="Kind">
              <option value="">All kinds</option>
              {["request", "answer", "ask", "reply", "message", "notice"].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <select className="select" value={state} onChange={(e) => (setState(e.target.value), setPage(0))} aria-label="State">
              <option value="">All states</option>
              {["pending", "deferred", "sending", "delivered", "answered", "failed", "cancelled"].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </>
        }
      >
        {list.error && <ErrorBox error={list.error} retry={list.reload} />}
        {!list.data && !list.error ? (
          <div style={{ padding: 16, display: "grid", gap: 8 }}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} h={30} />
            ))}
          </div>
        ) : rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Message</th>
                  <th>Direction</th>
                  <th>Kind</th>
                  <th>Channel</th>
                  <th>State</th>
                  <th className="num">Size</th>
                  <th className="num">Latency</th>
                  <th>Preview</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="clickable" onClick={() => setOpen(m)}>
                    <td className="muted tabular" title={new Date(m.createdAt).toLocaleString()}>
                      {ago(m.createdAt, now)}
                    </td>
                    <td className="mono">
                      {m.id}
                      {m.linkId && <span className="muted"> · {m.linkId}</span>}
                    </td>
                    <td>
                      <div className="row">
                        <AppBadge e={m.from} compact />
                        <IArrowRight size={12} />
                        {m.to ? <AppBadge e={m.to} compact /> : <Badge tone="warning">pending</Badge>}
                      </div>
                    </td>
                    <td>{m.decision ? <DecisionBadge decision={m.decision.decision} /> : m.kind}</td>
                    <td className="muted">{m.channel ?? "—"}</td>
                    <td>
                      <StateBadge state={m.state} />
                    </td>
                    <td className="num">{bytes(m.bytes)}</td>
                    <td className="num muted">{m.deliveredAt ? duration(m.deliveredAt - m.createdAt) : "—"}</td>
                    <td>
                      <div className="trunc muted" style={{ maxWidth: 300 }}>
                        {m.decision ? m.decision.note : m.body.slice(0, 160)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={<ITraffic />} title="No messages in this range" />
        )}
        {(page > 0 || more) && (
          <div className="row" style={{ padding: 12, justifyContent: "flex-end", borderTop: "1px solid var(--border)" }}>
            <span className="muted small">Page {page + 1}</span>
            <button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <button className="btn sm" disabled={!more} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </div>
        )}
      </Card>
      <Drawer
        open={!!open}
        onClose={() => setOpen(null)}
        title={
          open && (
            <span className="row">
              <span className="mono">{open.id}</span> <StateBadge state={open.state} />
            </span>
          )
        }
        actions={
          open?.linkId && (
            <button className="btn sm" onClick={() => navigate("conversations", open.linkId)}>
              Open conversation
            </button>
          )
        }
      >
        {open && (
          <>
            <dl className="kv">
              <dt>From</dt>
              <dd>
                <AppBadge e={open.from} />
              </dd>
              <dt>To</dt>
              <dd>{open.to ? <AppBadge e={open.to} /> : "—"}</dd>
              <dt>Kind</dt>
              <dd>
                {open.kind} · round {open.round}
              </dd>
              <dt>Channel</dt>
              <dd>{open.channel ?? "—"}</dd>
              <dt>Size</dt>
              <dd>{bytes(open.bytes)}</dd>
              <dt>Created</dt>
              <dd>{new Date(open.createdAt).toLocaleString()}</dd>
              <dt>Delivered</dt>
              <dd>{open.deliveredAt ? `${new Date(open.deliveredAt).toLocaleString()} (${duration(open.deliveredAt - open.createdAt)})` : "—"}</dd>
              <dt>Attempts</dt>
              <dd>{open.attempts}</dd>
              {open.error && (
                <>
                  <dt>Error</dt>
                  <dd style={{ color: "var(--critical)" }}>{open.error}</dd>
                </>
              )}
            </dl>
            <Card title="Content" right={<CopyButton text={open.body} label="Copy" />}>
              <Markdown text={open.body} />
            </Card>
          </>
        )}
      </Drawer>
    </div>
  );
}
