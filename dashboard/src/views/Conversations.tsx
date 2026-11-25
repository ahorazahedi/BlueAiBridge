import { useEffect, useMemo, useRef, useState } from "react";
import { api, type LinkDetail, type LinkRow, type Message } from "../lib/api";
import { navigate, useApi, useNow } from "../lib/hooks";
import { AppBadge, Badge, Card, Confirm, CopyButton, DecisionBadge, Empty, ErrorBox, Segmented, Skeleton, StateBadge, useToast } from "../components/ui";
import { Markdown } from "../components/Markdown";
import { ago, appLabel, bytes, dateTime, duration, epLabel, time } from "../lib/format";
import { ClaudeMark, GptMark, IAlert, IArrowRight, IBridge, IChat, ICheckCircle, IExternal, IFolder, IRefresh, ISearch, IX } from "../components/icons";
import { EventLine } from "./Activity";

const KIND_LABEL: Record<string, string> = { review: "Review", auto: "Auto mode", ask: "Question", turn: "Turn review" };

export function Conversations({ selected }: { selected: string | null }) {
  const [status, setStatus] = useState<"active" | "all" | "closed">("all");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const statusParam = status === "active" ? "open,waiting_join,answered" : status === "closed" ? "closed" : "";
  const list = useApi<{ links: LinkRow[] }>(`/api/links?limit=300&status=${statusParam}&kind=${kind}&q=${encodeURIComponent(debounced)}`, {
    live: (e) => e.type.startsWith("link.") || e.type.startsWith("message.") || e.type.startsWith("review.") || e.type.startsWith("delivery."),
  });
  const now = useNow();
  useEffect(() => {
    if (!selected && list.data?.links[0] && window.innerWidth > 1100) navigate("conversations", list.data.links[0].id);
  }, [selected, list.data]);

  return (
    <div className="page" style={{ maxWidth: "none" }}>
      <div className="split">
        <section className="card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: 12, display: "grid", gap: 10, borderBottom: "1px solid var(--border)" }}>
            <div className="search">
              <ISearch size={14} />
              <input className="input" placeholder="Search topic or link id (L12)…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search conversations" />
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <Segmented value={status} onChange={setStatus} options={[{ value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "closed", label: "Closed" }]} label="Status" />
              <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind" style={{ height: 30 }}>
                <option value="">All kinds</option>
                <option value="review">Reviews</option>
                <option value="auto">Auto mode</option>
                <option value="turn">Turn reviews</option>
                <option value="ask">Questions</option>
              </select>
            </div>
          </div>
          <div className="list" style={{ overflowY: "auto", flex: 1 }}>
            {list.error && <ErrorBox error={list.error} retry={list.reload} />}
            {!list.data && !list.error &&
              [0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="list-item">
                  <Skeleton h={14} w="60%" />
                  <Skeleton h={12} w="90%" />
                </div>
              ))}
            {list.data?.links.map((l) => (
              <div key={l.id} className={`list-item ${selected === l.id ? "on" : ""}`} onClick={() => navigate("conversations", l.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && navigate("conversations", l.id)}>
                <div className="row">
                  <span className="mono muted small">{l.id}</span>
                  <Badge tone="outline">{KIND_LABEL[l.kind] ?? l.kind}{l.reviewKind === "plan" ? " · plan" : ""}</Badge>
                  <span className="muted small" style={{ marginLeft: "auto" }}>
                    {ago(l.updatedAt, now)}
                  </span>
                </div>
                <div className="title">{l.title || "(untitled)"}</div>
                <div className="row">
                  <AppBadge e={l.requester} compact />
                  <IArrowRight size={12} />
                  {l.reviewer ? <AppBadge e={l.reviewer} compact /> : <Badge tone="warning">{l.joinCode ? `code ${l.joinCode}` : "pending"}</Badge>}
                  <span style={{ marginLeft: "auto" }} className="row">
                    {l.lastMessage?.decision ? <DecisionBadge decision={l.lastMessage.decision.decision} /> : <StateBadge state={l.status} />}
                  </span>
                </div>
              </div>
            ))}
            {list.data && !list.data.links.length && (
              <Empty icon={<IChat />} title="No conversations">
                {debounced || kind || status !== "all" ? "Nothing matches these filters." : "Conversations appear here as soon as one chat asks the other."}
              </Empty>
            )}
          </div>
        </section>
        {selected ? <LinkView id={selected} /> : <Card><Empty icon={<IChat />} title="Select a conversation">Pick one on the left to see the full exchange.</Empty></Card>}
      </div>
    </div>
  );
}

function LinkView({ id }: { id: string }) {
  const d = useApi<LinkDetail>(`/api/links/${id}`, { live: (e) => e.linkId === id || (!!e.messageId && e.type.startsWith("delivery.")) });
  const [tab, setTab] = useState<"thread" | "events" | "details">("thread");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const scroller = useRef<HTMLDivElement>(null);
  const count = d.data?.messages.length ?? 0;
  useEffect(() => {
    const el = scroller.current;
    if (el && tab === "thread") el.scrollTop = el.scrollHeight;
  }, [count, tab]);

  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  if (!d.data)
    return (
      <Card>
        <div style={{ display: "grid", gap: 12 }}>
          <Skeleton h={22} w="50%" />
          <Skeleton h={90} />
          <Skeleton h={90} />
        </div>
      </Card>
    );
  const { link, messages, events } = d.data;
  const totalBytes = messages.reduce((a, m) => a + m.bytes, 0);
  const lastAnswer = [...messages].reverse().find((m) => m.decision);

  const close = async () => {
    setBusy(true);
    try {
      await api(`/api/links/${link.id}/close`, { method: "POST", body: {} });
      toast({ tone: "good", title: `${link.id} closed`, body: "Unsent messages were cancelled." });
      setConfirm(false);
      void d.reload();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't close", body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "grid", gap: 10 }}>
        <div className="row wrap">
          <span className="mono muted">{link.id}</span>
          <Badge tone="outline">{KIND_LABEL[link.kind] ?? link.kind}{link.reviewKind ? ` · ${link.reviewKind}` : ""}</Badge>
          <StateBadge state={link.status} />
          {lastAnswer?.decision && <DecisionBadge decision={lastAnswer.decision.decision} />}
          <Badge tone="neutral">round {link.round}</Badge>
          <Badge tone="neutral">{link.delivery}</Badge>
          <div style={{ marginLeft: "auto" }} className="row">
            <button className="btn sm ghost" onClick={() => void d.reload()} title="Refresh">
              <IRefresh size={14} />
            </button>
            {link.status !== "closed" && (
              <button className="btn sm danger" onClick={() => setConfirm(true)}>
                <IX size={13} /> Close link
              </button>
            )}
          </div>
        </div>
        <h3 style={{ margin: 0, fontSize: 17, letterSpacing: "-0.01em" }}>{link.title || "(untitled)"}</h3>
        <div className="row wrap small muted">
          <Participant e={link.requester} title={d.data.requester?.title} role="asked" />
          <IArrowRight size={13} />
          {link.reviewer ? <Participant e={link.reviewer} title={d.data.reviewer?.title} role={link.kind === "ask" ? "answers" : "reviews"} /> : <Badge tone="warning">{link.joinCode ? `waiting for code ${link.joinCode}` : "reviewer created on first delivery"}</Badge>}
          <span style={{ marginLeft: "auto" }}>
            {messages.length} messages · {bytes(totalBytes)} · started {dateTime(link.createdAt)}
          </span>
        </div>
      </div>
      <div className="tabs">
        {(["thread", "events", "details"] as const).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "thread" ? "Conversation" : t === "events" ? `Events (${events.length})` : "Details"}
          </button>
        ))}
      </div>
      <div ref={scroller} style={{ overflowY: "auto", flex: 1, background: "var(--bg)" }}>
        {tab === "thread" && (
          <div className="thread">
            {messages.map((m) => (
              <MessageView key={m.id} m={m} requesterKey={`${link.requester.app}:${link.requester.id}`} onChange={() => void d.reload()} />
            ))}
            {!messages.length && <Empty title="No messages yet" />}
          </div>
        )}
        {tab === "events" && (
          <div className="feed" style={{ background: "var(--surface)" }}>
            {events.map((e) => (
              <EventLine key={e.id} e={e} />
            ))}
          </div>
        )}
        {tab === "details" && (
          <div style={{ padding: 20 }}>
            <dl className="kv">
              <dt>Link</dt>
              <dd className="mono">{link.id}</dd>
              <dt>Kind</dt>
              <dd>{KIND_LABEL[link.kind]} {link.reviewKind ? `(${link.reviewKind})` : ""}{link.ownInitiative ? " · agent's own initiative" : ""}</dd>
              <dt>Requester</dt>
              <dd className="mono">{link.requester.app}:{link.requester.id}{d.data.requester?.surface ? ` · ${d.data.requester.surface}` : ""}</dd>
              <dt>Reviewer</dt>
              <dd className="mono">{link.reviewer ? `${link.reviewer.app}:${link.reviewer.id}` : "—"}{d.data.reviewer?.surface ? ` · ${d.data.reviewer.surface}` : ""}</dd>
              <dt>Delivery</dt>
              <dd>{link.delivery}</dd>
              <dt>Paths</dt>
              <dd>
                {link.paths.length
                  ? link.paths.map((p) => (
                      <div key={p} className="row mono small">
                        <IFolder size={13} /> {p}
                        {link.fingerprints[p] && <span className="muted">· {link.fingerprints[p].slice(0, 10)}</span>}
                      </div>
                    ))
                  : "—"}
              </dd>
              <dt>Created</dt>
              <dd>{new Date(link.createdAt).toLocaleString()}</dd>
              <dt>Updated</dt>
              <dd>{new Date(link.updatedAt).toLocaleString()}</dd>
              {link.closedAt && (
                <>
                  <dt>Closed</dt>
                  <dd>
                    {new Date(link.closedAt).toLocaleString()} — {link.closeReason}
                  </dd>
                </>
              )}
            </dl>
            <div className="row" style={{ marginTop: 16, gap: 8 }}>
              <button className="btn sm" onClick={() => navigate("chats", `${link.requester.app}:${link.requester.id}`)}>
                <IExternal size={13} /> Open requester's full chat
              </button>
              {link.reviewer && (
                <button className="btn sm" onClick={() => navigate("chats", `${link.reviewer!.app}:${link.reviewer!.id}`)}>
                  <IExternal size={13} /> Open reviewer's full chat
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <Confirm
        open={confirm}
        title={`Close ${link.id}?`}
        body="Messages not handed over yet are cancelled, and a late answer to this link is refused. The chats themselves are not changed."
        confirmLabel="Close link"
        danger
        busy={busy}
        onConfirm={close}
        onClose={() => setConfirm(false)}
      />
    </section>
  );
}

function Participant({ e, title, role }: { e: { app: "claude" | "codex"; id: string }; title?: string | null; role: string }) {
  return (
    <span className="row" title={`${e.app}:${e.id}`}>
      <AppBadge e={e} compact />
      <span>{title ? `“${title.slice(0, 40)}”` : epLabel(e)}</span>
      <span className="muted">{role}</span>
    </span>
  );
}

function MessageView({ m, requesterKey, onChange }: { m: Message; requesterKey: string; onChange: () => void }) {
  const [open, setOpen] = useState(m.kind !== "request" || m.body.length < 1200);
  const toast = useToast();
  const fromKey = m.from ? `${m.from.app}:${m.from.id}` : null;
  const right = fromKey !== null && fromKey !== requesterKey;
  const latency = m.deliveredAt ? m.deliveredAt - m.createdAt : null;
  const retry = async () => {
    try {
      await api(`/api/messages/${m.id}/retry`, { method: "POST", body: {} });
      toast({ tone: "good", title: `Retrying ${m.id}` });
      onChange();
    } catch (e) {
      toast({ tone: "error", title: "Retry failed", body: (e as Error).message });
    }
  };
  const body = useMemo(() => (m.decision ? null : m.body), [m]);

  if (!m.from)
    return (
      <div className="msg system">
        <div className="notice">
          <IBridge size={16} />
          <div style={{ flex: 1 }}>
            <div className="small muted" style={{ marginBottom: 2 }}>
              BlueAIBridge notice · {time(m.createdAt)} → {appLabel(m.to?.app)}
            </div>
            {m.body}
          </div>
          <StateBadge state={m.state} />
        </div>
      </div>
    );

  return (
    <div className={`msg ${right ? "right" : ""}`}>
      <div className={`avatar ${m.from.app}`}>{m.from.app === "claude" ? <ClaudeMark size={17} /> : <GptMark size={17} />}</div>
      <div className="bubble">
        <div className="bubble-head">
          <span className="who">{appLabel(m.from.app)}</span>
          <span>{labelFor(m)}</span>
          <span className="mono">{m.id}</span>
          {m.round > 1 && <span>round {m.round}</span>}
          <span>· {time(m.createdAt)}</span>
          <span style={{ marginLeft: "auto" }} className="row">
            <StateBadge state={m.state} />
            {m.channel && <Badge tone="outline">{m.channel}</Badge>}
            <span className="tabular">{bytes(m.bytes)}</span>
            {latency != null && <span className="tabular" title="Delivery latency">{duration(latency)}</span>}
            <CopyButton text={m.decision ? formatDecisionText(m) : m.body} />
          </span>
        </div>
        {m.decision ? (
          <div className={`decision ${m.decision.decision === "approved" ? "approved" : "changes"}`}>
            <h4>
              {m.decision.decision === "approved" ? <ICheckCircle size={16} style={{ color: "var(--good)" }} /> : <IAlert size={16} style={{ color: "var(--warning)" }} />}
              {m.decision.decision === "approved" ? "Approved" : "Changes requested"}
            </h4>
            <Markdown text={m.decision.note} />
            {m.decision.blocking.length > 0 && (
              <div>
                <div className="lbl">Must fix</div>
                <ul>
                  {m.decision.blocking.map((b, i) => (
                    <li key={i}>
                      <Markdown text={b} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {m.decision.nits.length > 0 && (
              <div>
                <div className="lbl">Nits</div>
                <ul>
                  {m.decision.nits.map((b, i) => (
                    <li key={i}>
                      <Markdown text={b} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className={`bubble-body ${open ? "" : "collapsed"}`}>
              <Markdown text={body ?? ""} />
            </div>
            {!open && (
              <button className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => setOpen(true)}>
                Show full request ({bytes(m.bytes)})
              </button>
            )}
          </>
        )}
        {(m.error || m.deferReason) && (
          <div className="notice" style={{ marginTop: 10, background: m.state === "failed" ? "var(--critical-soft)" : "var(--warning-soft)" }}>
            <IAlert size={15} />
            <div style={{ flex: 1 }}>{m.state === "failed" ? m.error : m.deferReason ?? m.error}</div>
            {(m.state === "failed" || m.state === "deferred") && (
              <button className="btn sm" onClick={retry}>
                <IRefresh size={13} /> Retry now
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function labelFor(m: Message) {
  return m.kind === "request" ? "asked for a review" : m.kind === "answer" ? "answered" : m.kind === "ask" ? "asked" : m.kind === "reply" ? "replied" : m.kind === "message" ? "wrote" : m.kind;
}

function formatDecisionText(m: Message) {
  const d = m.decision!;
  return [d.decision === "approved" ? "[APPROVED]" : "[CHANGES REQUESTED]", "", d.note, ...(d.blocking.length ? ["", "Must fix:", ...d.blocking.map((b) => `- ${b}`)] : []), ...(d.nits.length ? ["", "Nits:", ...d.nits.map((b) => `- ${b}`)] : [])].join("\n");
}
