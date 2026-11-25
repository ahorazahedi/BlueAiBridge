import { useEffect, useState } from "react";
import { api, type ChatPage, type ChatSummary } from "../lib/api";
import { navigate, useApi } from "../lib/hooks";
import { Badge, Card, Empty, ErrorBox, Segmented, Skeleton } from "../components/ui";
import { Markdown } from "../components/Markdown";
import { ago, bytes } from "../lib/format";
import { ClaudeMark, GptMark, IBook, ISearch, ITerminal, IFolder } from "../components/icons";

export function Chats({ selected }: { selected: string | null }) {
  const [app, setApp] = useState<"" | "claude" | "codex">("");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const list = useApi<{ chats: ChatSummary[]; complete: boolean; total: number }>(`/api/chats?limit=150&app=${app}&q=${encodeURIComponent(debounced)}`);
  const [selApp, ...rest] = (selected ?? "").split(":");
  const selId = rest.join(":");

  return (
    <div className="page" style={{ maxWidth: "none" }}>
      <div className="split">
        <section className="card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: 12, display: "grid", gap: 10, borderBottom: "1px solid var(--border)" }}>
            <div className="search">
              <ISearch size={14} />
              <input className="input" placeholder="Find a chat by name or id…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search chats" />
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <Segmented value={app} onChange={setApp} options={[{ value: "", label: "Both apps" }, { value: "claude", label: "Claude" }, { value: "codex", label: "ChatGPT" }]} label="App" />
              {list.data && <span className="muted small">{list.data.total} chats{list.data.complete ? "" : "+"}</span>}
            </div>
          </div>
          <div className="list" style={{ overflowY: "auto", flex: 1 }}>
            {list.error && <ErrorBox error={list.error} retry={list.reload} />}
            {!list.data && !list.error && [0, 1, 2, 3, 4].map((i) => <div className="list-item" key={i}><Skeleton h={14} w="70%" /><Skeleton h={12} w="40%" /></div>)}
            {list.data?.chats.map((c) => (
              <div key={`${c.app}:${c.id}`} className={`list-item ${selApp === c.app && selId === c.id ? "on" : ""}`} onClick={() => navigate("chats", `${c.app}:${c.id}`)} role="button" tabIndex={0}>
                <div className="row">
                  <Badge tone={c.app === "claude" ? "claude" : "gpt"}>
                    {c.app === "claude" ? <ClaudeMark size={11} /> : <GptMark size={11} />} {c.app === "claude" ? "Claude" : "ChatGPT"}
                  </Badge>
                  <span className="muted small" style={{ marginLeft: "auto" }}>
                    {ago(c.updatedAt)} · {bytes(c.size)}
                  </span>
                </div>
                <div className="title">{c.title}</div>
                {c.cwd && <div className="meta mono trunc">{c.cwd}</div>}
              </div>
            ))}
            {list.data && !list.data.chats.length && <Empty icon={<IBook />} title="No chats found" />}
          </div>
        </section>
        {selected && selId ? (
          <ChatReader app={selApp as "claude" | "codex"} id={selId} />
        ) : (
          <Card>
            <Empty icon={<IBook />} title="Read any local chat">
              Every Claude Code session and ChatGPT/Codex thread stored on this Mac, read-only. Open one to see the whole conversation, including the bridge messages inside it.
            </Empty>
          </Card>
        )}
      </div>
    </div>
  );
}

function ChatReader({ app, id }: { app: "claude" | "codex"; id: string }) {
  const [pages, setPages] = useState<ChatPage[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const [tools, setTools] = useState(false);
  const load = async (cursor?: string) => {
    setLoading(true);
    try {
      const p = await api<ChatPage>(`/api/chats/${app}/${encodeURIComponent(id)}?${cursor ? `cursor=${cursor}&` : ""}${tools ? "tools=1" : ""}`);
      setPages((xs) => (cursor ? [p, ...xs] : [p]));
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    setPages([]);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, id, tools]);
  const first = pages[0];
  const head = pages[pages.length - 1];
  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "grid", gap: 6 }}>
        <div className="row">
          <Badge tone={app === "claude" ? "claude" : "gpt"}>{app === "claude" ? "Claude Code session" : "ChatGPT thread"}</Badge>
          <span className="mono muted small">{id}</span>
          <label className="row small" style={{ marginLeft: "auto", cursor: "pointer" }}>
            <input type="checkbox" checked={tools} onChange={(e) => setTools(e.target.checked)} /> Show tool steps
          </label>
        </div>
        <h3 style={{ margin: 0, fontSize: 17 }}>{head?.title ?? "…"}</h3>
        {head?.cwd && (
          <div className="row small muted mono">
            <IFolder size={13} /> {head.cwd} · {head.total} messages
          </div>
        )}
        {head?.notes.map((n) => (
          <div key={n} className="small muted">
            {n}
          </div>
        ))}
      </div>
      <div style={{ overflowY: "auto", flex: 1, background: "var(--bg)" }}>
        {error && <div style={{ padding: 16 }}><ErrorBox error={error} retry={() => void load()} /></div>}
        <div className="thread">
          {first?.nextCursor && (
            <button className="btn" style={{ justifySelf: "center" }} disabled={loading} onClick={() => void load(first.nextCursor!)}>
              {loading && <span className="spinner" />} Load older messages ({first.start} more)
            </button>
          )}
          {pages.flatMap((p) => p.messages).map((m, i) =>
            m.role === "tool" ? (
              <div key={i} className="row small muted mono" style={{ paddingLeft: 48 }}>
                <ITerminal size={13} /> {m.text}
              </div>
            ) : (
              <div key={i} className={`msg ${m.role === "user" ? "right" : ""}`}>
                <div className={`avatar ${m.role === "user" ? "bridge" : app}`} style={m.role === "user" ? { background: "linear-gradient(135deg,#64748b,#334155)" } : undefined}>
                  {m.role === "user" ? "You" : app === "claude" ? <ClaudeMark size={17} /> : <GptMark size={17} />}
                </div>
                <div className="bubble">
                  <div className="bubble-head">
                    <span className="who">{m.role === "user" ? (m.text.startsWith("CLAUDE:") || m.text.startsWith("CHATGPT:") ? "Bridge message" : "User") : app === "claude" ? "Claude" : "ChatGPT"}</span>
                    {m.ts && <span>{new Date(m.ts).toLocaleString()}</span>}
                    {m.cut && <Badge tone="warning">cut at 25k chars</Badge>}
                  </div>
                  <div className="bubble-body">
                    <Markdown text={m.text} />
                  </div>
                </div>
              </div>
            ),
          )}
          {!loading && pages.length > 0 && !pages.some((p) => p.messages.length) && <Empty title="This chat has no readable messages" />}
          {loading && !pages.length && <Skeleton h={120} />}
        </div>
      </div>
    </section>
  );
}
