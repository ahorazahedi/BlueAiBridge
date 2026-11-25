import { useApi, navigate, useNow, recentEvents, useLiveRefresh } from "../lib/hooks";
import type { BridgeEvent, LinkRow, SeriesPoint, Summary, Limits } from "../lib/api";
import { Card, Kpi, AppBadge, StateBadge, DecisionBadge, Empty, Skeleton, ErrorBox, Badge } from "../components/ui";
import { TrafficChart, Legend, TRAFFIC_LEGEND, BarList, SplitBar, Sparkline } from "../components/charts";
import { ago, bytes, duration, num, pct } from "../lib/format";
import { IAlert, ICheckCircle, IChat, IClock, IData, ILink, IBolt, IUsers, ClaudeMark, GptMark, IArrowRight } from "../components/icons";
import { EventLine } from "./Activity";
import { useState } from "react";

const RANGE_MS: Record<string, number> = { "1h": 3600_000, "6h": 6 * 3600_000, "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 };

export function Overview({ range }: { range: string }) {
  const live = () => true;
  const summary = useApi<Summary>(`/api/summary?range=${range}`, { live });
  const series = useApi<{ points: SeriesPoint[]; bucketMs: number }>(`/api/series?range=${range}`, { live });
  const links = useApi<{ links: LinkRow[] }>(`/api/links?limit=8`, { live: (e) => e.type.startsWith("link.") || e.type.startsWith("message.") || e.type.startsWith("review.") });
  const limits = useApi<{ limits: Limits | null }>(`/api/limits`, { interval: 120_000 });
  const now = useNow();
  const s = summary.data;
  const pts = series.data?.points ?? [];
  const spark = (k: keyof SeriesPoint) => pts.slice(-16).map((p) => Number(p[k]));
  const total = (s?.decisions.approved ?? 0) + (s?.decisions.changes_requested ?? 0);

  const c2g = s?.byDirection.filter((d) => d.from === "claude").reduce((a, d) => ({ m: a.m + d.messages, b: a.b + d.bytes }), { m: 0, b: 0 }) ?? { m: 0, b: 0 };
  const g2c = s?.byDirection.filter((d) => d.from === "codex").reduce((a, d) => ({ m: a.m + d.messages, b: a.b + d.bytes }), { m: 0, b: 0 }) ?? { m: 0, b: 0 };
  const sys = s?.byDirection.filter((d) => d.from === "bridge").reduce((a, d) => ({ m: a.m + d.messages, b: a.b + d.bytes }), { m: 0, b: 0 }) ?? { m: 0, b: 0 };

  if (summary.error) return <ErrorBox error={summary.error} retry={summary.reload} />;

  return (
    <div className="page">
      <div className="grid kpis">
        <Kpi label="Messages" icon={<IChat size={14} />} value={s ? num(s.messages) : <Skeleton h={28} w={80} />} hint={s ? `${num(s.pending)} waiting to be delivered` : " "} spark={<Sparkline values={spark("claudeToChatgpt").map((v, i) => v + spark("chatgptToClaude")[i] + spark("bridge")[i])} />} />
        <Kpi label="Data transferred" icon={<IData size={14} />} value={s ? bytes(s.bytes) : <Skeleton h={28} w={80} />} hint="Requests, answers and messages" spark={<Sparkline values={spark("bytes")} color="var(--series-gpt)" />} />
        <Kpi label="Open conversations" icon={<ILink size={14} />} value={s ? num(s.openLinks) : <Skeleton h={28} w={60} />} hint={s ? `${s.autosOn} auto mode${s.autosOn === 1 ? "" : "s"} on` : " "} />
        <Kpi label="Avg review time" icon={<IClock size={14} />} value={s ? duration(s.avgReviewMs) : <Skeleton h={28} w={80} />} hint={s ? `delivery ${duration(s.avgDeliveryMs)}` : " "} />
        <Kpi
          label="Failure rate"
          icon={<IAlert size={14} />}
          value={s ? pct(s.failed, s.messages) : <Skeleton h={28} w={60} />}
          hint={s ? (s.failed ? <span style={{ color: "var(--critical)" }}>{s.failed} failed deliveries</span> : "No failed deliveries") : " "}
        />
        <Kpi label="Active chats" icon={<IUsers size={14} />} value={s ? num(s.clients) : <Skeleton h={28} w={60} />} hint="Seen in this range" />
      </div>

      <div className="grid two">
        <Card title="Traffic" sub="Messages through the bridge, by direction" right={<Legend items={TRAFFIC_LEGEND} />}>
          {series.data ? <TrafficChart points={pts} bucketMs={series.data.bucketMs} rangeMs={RANGE_MS[range]} /> : <Skeleton h={240} />}
        </Card>
        <Card title="Data flow" sub={`Last ${range}`}>
          <div className="flow">
            <div className="node">
              <div className="avatar claude">
                <ClaudeMark size={18} />
              </div>
              <strong>Claude</strong>
              <span className="muted small">Code tab · CLI</span>
            </div>
            <div className="arrows">
              <FlowArrow label={`${num(c2g.m)} msgs · ${bytes(c2g.b)}`} color="var(--series-claude)" dir="right" />
              <FlowArrow label={`${num(g2c.m)} msgs · ${bytes(g2c.b)}`} color="var(--series-gpt)" dir="left" />
            </div>
            <div className="node">
              <div className="avatar codex">
                <GptMark size={18} />
              </div>
              <strong>ChatGPT</strong>
              <span className="muted small">Desktop · CLI</span>
            </div>
          </div>
          <div className="hr" style={{ margin: "16px 0" }} />
          <BarList
            format={num}
            rows={(s?.byChannel ?? [])
              .filter((c) => c.channel !== "none")
              .map((c) => ({
                label: <span className="row">{channelLabel(c.channel)}</span>,
                value: c.messages,
                sub: bytes(c.bytes),
                color: c.channel === "headless" ? "var(--series-gpt)" : c.channel === "note" ? "var(--series-bridge)" : "var(--series-claude)",
              }))}
          />
          {sys.m > 0 && <div className="muted small" style={{ marginTop: 10 }}>+ {num(sys.m)} notices from BlueAIBridge ({bytes(sys.b)})</div>}
        </Card>
      </div>

      <div className="grid two">
        <Card
          title="Recent conversations"
          right={
            <button className="btn sm" onClick={() => navigate("conversations")}>
              View all <IArrowRight size={13} />
            </button>
          }
          flush
        >
          {!links.data ? (
            <div style={{ padding: 16, display: "grid", gap: 10 }}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} h={36} />
              ))}
            </div>
          ) : links.data.links.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Link</th>
                    <th>Between</th>
                    <th>Topic</th>
                    <th>Status</th>
                    <th className="num">Msgs</th>
                    <th className="num">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {links.data.links.map((l) => (
                    <tr key={l.id} className="clickable" onClick={() => navigate("conversations", l.id)}>
                      <td className="mono">{l.id}</td>
                      <td>
                        <div className="row">
                          <AppBadge e={l.requester} compact />
                          <IArrowRight size={12} />
                          {l.reviewer ? <AppBadge e={l.reviewer} compact /> : <Badge tone="warning">{l.joinCode ? `code ${l.joinCode}` : "pending"}</Badge>}
                        </div>
                      </td>
                      <td>
                        <div className="trunc" style={{ maxWidth: 320 }}>
                          {l.title || <span className="muted">(untitled)</span>}
                        </div>
                      </td>
                      <td>
                        <div className="row">
                          {l.lastMessage?.decision ? <DecisionBadge decision={l.lastMessage.decision.decision} /> : <StateBadge state={l.status} />}
                        </div>
                      </td>
                      <td className="num">{l.messageCount}</td>
                      <td className="num muted">{ago(l.updatedAt, now)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon={<IChat />} title="No conversations yet">
              Ask from Claude Code: <em>"Ask ChatGPT to review this change"</em>, or from ChatGPT: <em>"Ask Claude for a second opinion"</em>.
            </Empty>
          )}
        </Card>
        <div className="grid" style={{ alignContent: "start" }}>
          <Card title="Review verdicts" sub={`${total} in the last ${range}`}>
            <SplitBar
              parts={[
                {
                  label: (
                    <>
                      <ICheckCircle size={14} style={{ color: "var(--good)" }} /> Approved
                    </>
                  ),
                  value: s?.decisions.approved ?? 0,
                  color: "var(--good)",
                },
                {
                  label: (
                    <>
                      <IAlert size={14} style={{ color: "var(--warning)" }} /> Changes requested
                    </>
                  ),
                  value: s?.decisions.changes_requested ?? 0,
                  color: "var(--warning-mark)",
                },
              ]}
            />
          </Card>
          <Card title="ChatGPT usage" sub="Codex rate-limit windows">
            {limits.data?.limits ? <LimitsView l={limits.data.limits} /> : <div className="muted small">{limits.loading ? "Checking…" : "Not available (ChatGPT Desktop not installed or not signed in)."}</div>}
          </Card>
          <LiveFeed />
        </div>
      </div>
    </div>
  );
}

function FlowArrow({ label, color, dir }: { label: string; color: string; dir: "left" | "right" }) {
  return (
    <div className="arrow">
      <span>{label}</span>
      <svg width="100%" height="10" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden>
        <line x1="2" y1="5" x2="98" y2="5" stroke={color} strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {dir === "right" ? <path d="M92 1 L98 5 L92 9" fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" /> : <path d="M8 1 L2 5 L8 9" fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  );
}

export function channelLabel(c: string) {
  return c === "visible" ? "Visible (in the app's chat)" : c === "headless" ? "Headless (background CLI)" : c === "inline" ? "Inline (tool result)" : c === "note" ? "With the next prompt" : c;
}

function LimitsView({ l }: { l: Limits }) {
  const bar = (label: string, w: Limits["primary"]) =>
    w && (
      <div style={{ display: "grid", gap: 4 }}>
        <div className="row small" style={{ justifyContent: "space-between" }}>
          <span>{label}</span>
          <span className="tabular">
            <strong>{Math.round(w.usedPercent)}%</strong> used{w.resetsAt ? <span className="muted"> · resets {ago(w.resetsAt)}</span> : null}
          </span>
        </div>
        <div className="b-track" style={{ height: 8, background: "var(--surface-3)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ width: `${Math.min(100, w.usedPercent)}%`, height: "100%", borderRadius: 4, background: w.usedPercent >= 90 ? "var(--critical)" : w.usedPercent >= 70 ? "var(--warning-mark)" : "var(--series-claude)" }} />
        </div>
      </div>
    );
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {l.blocked && (
        <Badge tone="critical">
          <IAlert size={12} /> Limit reached — reviews wait until it resets
        </Badge>
      )}
      {bar("Primary window", l.primary)}
      {bar("Secondary window", l.secondary)}
      {l.credits && <span className="muted small">Credits available</span>}
    </div>
  );
}

function LiveFeed() {
  const initial = useApi<{ events: BridgeEvent[] }>("/api/events?limit=40");
  const [, force] = useState(0);
  useLiveRefresh(() => force((x) => x + 1), () => true, 150);
  const seen = new Set<number>();
  const events = [...recentEvents(), ...(initial.data?.events ?? [])]
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .filter((e) => !e.type.startsWith("tool.") && e.type !== "client.seen" && e.type !== "message.created")
    .sort((a, b) => b.id - a.id)
    .slice(0, 7);
  return (
    <Card
      title={
        <span className="row">
          <IBolt size={14} /> Live activity
        </span>
      }
      right={
        <button className="btn sm ghost" onClick={() => navigate("activity")}>
          All
        </button>
      }
      flush
    >
      {events.length ? (
        <div className="feed">
          {events.map((e) => (
            <EventLine key={e.id} e={e} compact />
          ))}
        </div>
      ) : (
        <div className="muted small" style={{ padding: 16 }}>
          Waiting for activity… new events appear here live.
        </div>
      )}
    </Card>
  );
}
