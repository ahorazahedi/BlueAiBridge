// Persistent state in SQLite (WAL): chats, links, messages, auto mode and the
// event log the dashboard monitors. Only the broker process opens it.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { AutoState, BridgeEvent, ClientInfo, Decision, Endpoint, Link, Message, MessageKind, MessageState } from "../shared/types.js";
import { keyOf } from "../shared/types.js";
import { bytesOf, now } from "../shared/util.js";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clients (
  key TEXT PRIMARY KEY, app TEXT NOT NULL, id TEXT NOT NULL, surface TEXT NOT NULL DEFAULT 'unknown',
  cwd TEXT, title TEXT, host_id TEXT, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, listener_at INTEGER
);
CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, review_kind TEXT, status TEXT NOT NULL,
  requester TEXT NOT NULL, reviewer TEXT, join_code TEXT UNIQUE, delivery TEXT NOT NULL,
  round INTEGER NOT NULL DEFAULT 1, paths TEXT NOT NULL DEFAULT '[]', title TEXT NOT NULL DEFAULT '',
  own_initiative INTEGER NOT NULL DEFAULT 0, fingerprints TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, closed_at INTEGER, close_reason TEXT
);
CREATE INDEX IF NOT EXISTS links_status ON links(status);
CREATE INDEX IF NOT EXISTS links_requester ON links(requester);
CREATE INDEX IF NOT EXISTS links_reviewer ON links(reviewer);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, link_id TEXT, kind TEXT NOT NULL, from_ep TEXT, to_ep TEXT, body TEXT NOT NULL,
  decision TEXT, round INTEGER NOT NULL DEFAULT 1, reply_to TEXT, state TEXT NOT NULL, channel TEXT,
  attempts INTEGER NOT NULL DEFAULT 0, error TEXT, deferred_until INTEGER, defer_reason TEXT,
  bytes INTEGER NOT NULL, created_at INTEGER NOT NULL, delivered_at INTEGER, answered_at INTEGER, client_id TEXT
);
CREATE INDEX IF NOT EXISTS messages_link ON messages(link_id);
CREATE INDEX IF NOT EXISTS messages_state ON messages(state);
CREATE INDEX IF NOT EXISTS messages_to ON messages(to_ep, state);
CREATE INDEX IF NOT EXISTS messages_created ON messages(created_at);
CREATE TABLE IF NOT EXISTS autos (key TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, type TEXT NOT NULL, link_id TEXT, message_id TEXT,
  actor TEXT, bytes INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS events_link ON events(link_id);
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS turns_owner ON turns(owner, state);
`;

const epStr = (e: Endpoint | null) => (e ? keyOf(e) : null);
const epParse = (s: unknown): Endpoint | null => {
  if (typeof s !== "string" || !s) return null;
  const i = s.indexOf(":");
  return { app: s.slice(0, i) as Endpoint["app"], id: s.slice(i + 1) };
};
type Row = Record<string, unknown>;

export type EventListener = (e: BridgeEvent) => void;

export class Store {
  readonly db: DatabaseSync;
  private listeners = new Set<EventListener>();

  constructor(file: string) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
    if (file !== ":memory:") {
      try {
        fs.chmodSync(file, 0o600);
      } catch {
        /* best effort */
      }
    }
  }

  close() {
    this.db.close();
  }

  // ---------- counters & ids ----------

  private nextId(prefix: string): string {
    const k = `seq:${prefix}`;
    const row = this.db.prepare("SELECT v FROM meta WHERE k = ?").get(k) as Row | undefined;
    const n = Number(row?.v ?? 0) + 1;
    this.db.prepare("INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, String(n));
    return `${prefix}${n}`;
  }

  getMeta(k: string): string | null {
    const row = this.db.prepare("SELECT v FROM meta WHERE k = ?").get(k) as Row | undefined;
    return (row?.v as string) ?? null;
  }
  setMeta(k: string, v: string) {
    this.db.prepare("INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, v);
  }

  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  // ---------- events ----------

  onEvent(fn: EventListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  event(type: string, opts: { linkId?: string | null; messageId?: string | null; actor?: string | null; bytes?: number; data?: Record<string, unknown> } = {}): BridgeEvent {
    const ev = {
      ts: now(),
      type,
      linkId: opts.linkId ?? null,
      messageId: opts.messageId ?? null,
      actor: opts.actor ?? null,
      bytes: opts.bytes ?? 0,
      data: opts.data ?? {},
    };
    const r = this.db
      .prepare("INSERT INTO events(ts, type, link_id, message_id, actor, bytes, data) VALUES(?, ?, ?, ?, ?, ?, ?)")
      .run(ev.ts, ev.type, ev.linkId, ev.messageId, ev.actor, ev.bytes, JSON.stringify(ev.data));
    const full: BridgeEvent = { id: Number(r.lastInsertRowid), ...ev };
    for (const l of this.listeners) {
      try {
        l(full);
      } catch {
        /* a listener never breaks a write */
      }
    }
    return full;
  }

  events(opts: { since?: number; afterId?: number; linkId?: string; type?: string; limit?: number } = {}): BridgeEvent[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.since) where.push("ts >= ?"), args.push(opts.since);
    if (opts.afterId) where.push("id > ?"), args.push(opts.afterId);
    if (opts.linkId) where.push("link_id = ?"), args.push(opts.linkId);
    if (opts.type) where.push("type LIKE ?"), args.push(opts.type.replace(/\*/g, "%"));
    const sql = `SELECT * FROM events ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`;
    args.push(Math.min(opts.limit ?? 200, 5000));
    return (this.db.prepare(sql).all(...args) as Row[]).map(rowEvent);
  }

  // ---------- clients ----------

  touchClient(e: Endpoint, info: Partial<Pick<ClientInfo, "surface" | "cwd" | "title" | "hostId">> = {}): ClientInfo {
    const t = now();
    const existing = this.client(e);
    if (!existing) {
      this.db
        .prepare("INSERT INTO clients(key, app, id, surface, cwd, title, host_id, first_seen, last_seen) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(keyOf(e), e.app, e.id, info.surface ?? "unknown", info.cwd ?? null, info.title ?? null, info.hostId ?? null, t, t);
      this.event("client.seen", { actor: keyOf(e), data: { surface: info.surface ?? "unknown", cwd: info.cwd ?? null } });
    } else {
      this.db
        .prepare(
          "UPDATE clients SET last_seen = ?, surface = CASE WHEN ? = 'unknown' THEN surface ELSE ? END, cwd = COALESCE(?, cwd), title = COALESCE(?, title), host_id = COALESCE(?, host_id) WHERE key = ?",
        )
        .run(t, info.surface ?? "unknown", info.surface ?? "unknown", info.cwd ?? null, info.title ?? null, info.hostId ?? null, keyOf(e));
    }
    return this.client(e)!;
  }

  client(e: Endpoint): ClientInfo | null {
    const r = this.db.prepare("SELECT * FROM clients WHERE key = ?").get(keyOf(e)) as Row | undefined;
    return r ? rowClient(r) : null;
  }

  clients(): ClientInfo[] {
    return (this.db.prepare("SELECT * FROM clients ORDER BY last_seen DESC LIMIT 500").all() as Row[]).map(rowClient);
  }

  setListener(e: Endpoint, at: number | null) {
    this.touchClient(e);
    this.db.prepare("UPDATE clients SET listener_at = ? WHERE key = ?").run(at, keyOf(e));
  }

  // ---------- links ----------

  createLink(l: Omit<Link, "id" | "createdAt" | "updatedAt" | "closedAt" | "closeReason">): Link {
    const id = this.nextId("L");
    const t = now();
    this.db
      .prepare(
        `INSERT INTO links(id, kind, review_kind, status, requester, reviewer, join_code, delivery, round, paths, title, own_initiative, fingerprints, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, l.kind, l.reviewKind, l.status, epStr(l.requester), epStr(l.reviewer), l.joinCode, l.delivery, l.round, JSON.stringify(l.paths), l.title, l.ownInitiative ? 1 : 0, JSON.stringify(l.fingerprints), t, t);
    const link = this.link(id)!;
    this.event("link.created", { linkId: id, actor: keyOf(l.requester), data: { kind: l.kind, reviewKind: l.reviewKind, reviewer: epStr(l.reviewer), delivery: l.delivery, joinCode: !!l.joinCode, title: l.title } });
    return link;
  }

  link(id: string): Link | null {
    const r = this.db.prepare("SELECT * FROM links WHERE id = ?").get(id) as Row | undefined;
    return r ? rowLink(r) : null;
  }

  linkByCode(code: string): Link | null {
    const r = this.db.prepare("SELECT * FROM links WHERE join_code = ? AND status = 'waiting_join'").get(code.trim().toLowerCase()) as Row | undefined;
    return r ? rowLink(r) : null;
  }

  updateLink(id: string, patch: Partial<Pick<Link, "status" | "reviewer" | "round" | "paths" | "title" | "fingerprints" | "delivery" | "joinCode" | "closeReason" | "reviewKind" | "ownInitiative">>) {
    const sets: string[] = ["updated_at = ?"];
    const args: (string | number | null)[] = [now()];
    const map: Record<string, [string, (v: never) => string | number | null]> = {
      status: ["status", (v: string) => v],
      reviewer: ["reviewer", (v: Endpoint | null) => epStr(v)],
      round: ["round", (v: number) => v],
      paths: ["paths", (v: string[]) => JSON.stringify(v)],
      title: ["title", (v: string) => v],
      fingerprints: ["fingerprints", (v: Record<string, string>) => JSON.stringify(v)],
      delivery: ["delivery", (v: string) => v],
      joinCode: ["join_code", (v: string | null) => v],
      closeReason: ["close_reason", (v: string | null) => v],
      reviewKind: ["review_kind", (v: string | null) => v],
      ownInitiative: ["own_initiative", (v: boolean) => (v ? 1 : 0)],
    };
    for (const [k, v] of Object.entries(patch)) {
      const m = map[k];
      if (!m) continue;
      sets.push(`${m[0]} = ?`);
      args.push(m[1](v as never));
    }
    if (patch.status === "closed") sets.push(`closed_at = ${now()}`);
    args.push(id);
    this.db.prepare(`UPDATE links SET ${sets.join(", ")} WHERE id = ?`).run(...args);
    return this.link(id)!;
  }

  links(opts: { status?: string[]; endpoint?: Endpoint; kind?: string; limit?: number; offset?: number; search?: string } = {}): Link[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.status?.length) where.push(`status IN (${opts.status.map(() => "?").join(",")})`), args.push(...opts.status);
    if (opts.endpoint) where.push("(requester = ? OR reviewer = ?)"), args.push(keyOf(opts.endpoint), keyOf(opts.endpoint));
    if (opts.kind) where.push("kind = ?"), args.push(opts.kind);
    if (opts.search) where.push("(title LIKE ? OR id = ?)"), args.push(`%${opts.search}%`, opts.search.toUpperCase());
    const sql = `SELECT * FROM links ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
    args.push(Math.min(opts.limit ?? 100, 1000), opts.offset ?? 0);
    return (this.db.prepare(sql).all(...args) as Row[]).map(rowLink);
  }

  // ---------- messages ----------

  createMessage(m: { linkId: string | null; kind: MessageKind; from: Endpoint | null; to: Endpoint | null; body: string; decision?: Decision | null; round?: number; replyTo?: string | null; state?: MessageState; channel?: Message["channel"] }): Message {
    const id = this.nextId("M");
    const bytes = bytesOf(m.body) + (m.decision ? bytesOf(JSON.stringify(m.decision)) : 0);
    this.db
      .prepare(
        `INSERT INTO messages(id, link_id, kind, from_ep, to_ep, body, decision, round, reply_to, state, channel, bytes, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, m.linkId, m.kind, epStr(m.from), epStr(m.to), m.body, m.decision ? JSON.stringify(m.decision) : null, m.round ?? 1, m.replyTo ?? null, m.state ?? "pending", m.channel ?? null, bytes, now());
    const msg = this.message(id)!;
    this.event("message.created", {
      linkId: m.linkId,
      messageId: id,
      actor: epStr(m.from),
      bytes,
      data: { kind: m.kind, to: epStr(m.to), round: msg.round, decision: m.decision?.decision ?? null },
    });
    return msg;
  }

  message(id: string): Message | null {
    const r = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as Row | undefined;
    return r ? rowMessage(r) : null;
  }

  updateMessage(id: string, patch: Partial<Pick<Message, "state" | "channel" | "attempts" | "error" | "deferredUntil" | "deferReason" | "deliveredAt" | "answeredAt" | "clientId" | "to">>) {
    const cols: Record<string, string> = {
      state: "state",
      channel: "channel",
      attempts: "attempts",
      error: "error",
      deferredUntil: "deferred_until",
      deferReason: "defer_reason",
      deliveredAt: "delivered_at",
      answeredAt: "answered_at",
      clientId: "client_id",
      to: "to_ep",
    };
    const sets: string[] = [];
    const args: (string | number | null)[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (!cols[k]) continue;
      sets.push(`${cols[k]} = ?`);
      args.push(k === "to" ? epStr(v as Endpoint | null) : (v as string | number | null));
    }
    if (!sets.length) return this.message(id)!;
    args.push(id);
    this.db.prepare(`UPDATE messages SET ${sets.join(", ")} WHERE id = ?`).run(...args);
    return this.message(id)!;
  }

  messages(opts: { linkId?: string; to?: Endpoint; from?: Endpoint; state?: MessageState[]; kind?: MessageKind[]; since?: number; until?: number; limit?: number; offset?: number; order?: "asc" | "desc"; search?: string } = {}): Message[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.linkId) where.push("link_id = ?"), args.push(opts.linkId);
    if (opts.to) where.push("to_ep = ?"), args.push(keyOf(opts.to));
    if (opts.from) where.push("from_ep = ?"), args.push(keyOf(opts.from));
    if (opts.state?.length) where.push(`state IN (${opts.state.map(() => "?").join(",")})`), args.push(...opts.state);
    if (opts.kind?.length) where.push(`kind IN (${opts.kind.map(() => "?").join(",")})`), args.push(...opts.kind);
    if (opts.since) where.push("created_at >= ?"), args.push(opts.since);
    if (opts.until) where.push("created_at < ?"), args.push(opts.until);
    if (opts.search) where.push("(body LIKE ? OR id = ?)"), args.push(`%${opts.search}%`, opts.search.toUpperCase());
    const sql = `SELECT * FROM messages ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at ${opts.order === "asc" ? "ASC" : "DESC"}, id ${opts.order === "asc" ? "ASC" : "DESC"} LIMIT ? OFFSET ?`;
    args.push(Math.min(opts.limit ?? 200, 5000), opts.offset ?? 0);
    return (this.db.prepare(sql).all(...args) as Row[]).map(rowMessage);
  }

  countMessages(opts: { since?: number } = {}): number {
    const r = this.db.prepare("SELECT COUNT(*) n FROM messages WHERE created_at >= ?").get(opts.since ?? 0) as Row;
    return Number(r.n);
  }

  // ---------- auto mode ----------

  auto(e: Endpoint): AutoState | null {
    const r = this.db.prepare("SELECT data FROM autos WHERE key = ?").get(keyOf(e)) as Row | undefined;
    return r ? (JSON.parse(String(r.data)) as AutoState) : null;
  }
  autos(): AutoState[] {
    return (this.db.prepare("SELECT data FROM autos").all() as Row[]).map((r) => JSON.parse(String(r.data)) as AutoState);
  }
  saveAuto(a: AutoState) {
    this.db.prepare("INSERT INTO autos(key, data) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data").run(a.key, JSON.stringify(a));
  }
  deleteAuto(e: Endpoint) {
    this.db.prepare("DELETE FROM autos WHERE key = ?").run(keyOf(e));
  }

  // ---------- every-turn records ----------

  putTurn(id: string, owner: Endpoint, state: string, data: unknown) {
    this.db
      .prepare("INSERT INTO turns(id, owner, state, data, created_at) VALUES(?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, data = excluded.data")
      .run(id, keyOf(owner), state, JSON.stringify(data), now());
  }
  turns(owner: Endpoint, state?: string): { id: string; state: string; data: Record<string, unknown>; createdAt: number }[] {
    const rows = (state
      ? this.db.prepare("SELECT * FROM turns WHERE owner = ? AND state = ? ORDER BY created_at").all(keyOf(owner), state)
      : this.db.prepare("SELECT * FROM turns WHERE owner = ? ORDER BY created_at").all(keyOf(owner))) as Row[];
    return rows.map((r) => ({ id: String(r.id), state: String(r.state), data: JSON.parse(String(r.data)), createdAt: Number(r.created_at) }));
  }
  setTurnState(id: string, state: string) {
    this.db.prepare("UPDATE turns SET state = ? WHERE id = ?").run(state, id);
  }

  // ---------- metrics for the dashboard ----------

  summary(since: number) {
    const one = (sql: string, ...a: (string | number)[]) => this.db.prepare(sql).get(...a) as Row;
    const msgs = one("SELECT COUNT(*) n, COALESCE(SUM(bytes),0) b FROM messages WHERE created_at >= ?", since);
    const failed = one("SELECT COUNT(*) n FROM messages WHERE created_at >= ? AND state = 'failed'", since);
    const lat = one("SELECT AVG(delivered_at - created_at) d FROM messages WHERE created_at >= ? AND delivered_at IS NOT NULL", since);
    const rt = one(
      "SELECT AVG(answered_at - created_at) d FROM messages WHERE created_at >= ? AND kind = 'request' AND answered_at IS NOT NULL",
      since,
    );
    const openLinks = one("SELECT COUNT(*) n FROM links WHERE status IN ('open','waiting_join')");
    const decisions = this.db
      .prepare("SELECT json_extract(decision, '$.decision') d, COUNT(*) n FROM messages WHERE created_at >= ? AND decision IS NOT NULL GROUP BY d")
      .all(since) as Row[];
    const byChannel = this.db.prepare("SELECT COALESCE(channel,'none') c, COUNT(*) n, COALESCE(SUM(bytes),0) b FROM messages WHERE created_at >= ? GROUP BY c").all(since) as Row[];
    const byDirection = this.db
      .prepare(
        "SELECT substr(COALESCE(from_ep,'bridge:'),1,instr(COALESCE(from_ep,'bridge:'),':')-1) f, substr(COALESCE(to_ep,'?:'),1,instr(COALESCE(to_ep,'?:'),':')-1) t, COUNT(*) n, COALESCE(SUM(bytes),0) b FROM messages WHERE created_at >= ? GROUP BY f, t",
      )
      .all(since) as Row[];
    const pending = one("SELECT COUNT(*) n FROM messages WHERE state IN ('pending','deferred','sending')");
    const autosOn = this.autos().filter((a) => a.on).length;
    return {
      messages: Number(msgs.n),
      bytes: Number(msgs.b),
      failed: Number(failed.n),
      avgDeliveryMs: lat.d == null ? null : Math.round(Number(lat.d)),
      avgReviewMs: rt.d == null ? null : Math.round(Number(rt.d)),
      openLinks: Number(openLinks.n),
      pending: Number(pending.n),
      autosOn,
      clients: Number(one("SELECT COUNT(*) n FROM clients WHERE last_seen >= ?", since).n),
      decisions: Object.fromEntries(decisions.map((r) => [String(r.d), Number(r.n)])),
      byChannel: byChannel.map((r) => ({ channel: String(r.c), messages: Number(r.n), bytes: Number(r.b) })),
      byDirection: byDirection.map((r) => ({ from: String(r.f), to: String(r.t), messages: Number(r.n), bytes: Number(r.b) })),
    };
  }

  /** Time buckets of messages and bytes, split by direction. */
  series(since: number, bucketMs: number) {
    const rows = this.db
      .prepare(
        `SELECT CAST(created_at / ? AS INTEGER) * ? AS t,
                SUM(CASE WHEN from_ep LIKE 'claude:%' THEN 1 ELSE 0 END) c2g,
                SUM(CASE WHEN from_ep LIKE 'codex:%' THEN 1 ELSE 0 END) g2c,
                SUM(CASE WHEN from_ep IS NULL THEN 1 ELSE 0 END) sys,
                SUM(bytes) b, SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) f
         FROM messages WHERE created_at >= ? GROUP BY t ORDER BY t`,
      )
      .all(bucketMs, bucketMs, since) as Row[];
    return rows.map((r) => ({ t: Number(r.t), claudeToChatgpt: Number(r.c2g), chatgptToClaude: Number(r.g2c), bridge: Number(r.sys), bytes: Number(r.b), failed: Number(r.f) }));
  }

  /** Delete closed links, their messages and old events past the retention window. */
  prune(retentionMs: number) {
    const cutoff = now() - retentionMs;
    return this.tx(() => {
      const old = this.db.prepare("SELECT id FROM links WHERE status = 'closed' AND COALESCE(closed_at, updated_at) < ?").all(cutoff) as Row[];
      for (const r of old) this.db.prepare("DELETE FROM messages WHERE link_id = ?").run(String(r.id));
      this.db.prepare("DELETE FROM links WHERE status = 'closed' AND COALESCE(closed_at, updated_at) < ?").run(cutoff);
      this.db.prepare("DELETE FROM messages WHERE link_id IS NULL AND created_at < ? AND state NOT IN ('pending','deferred','sending')").run(cutoff);
      const ev = this.db.prepare("DELETE FROM events WHERE ts < ?").run(cutoff);
      this.db.prepare("DELETE FROM turns WHERE created_at < ? AND state != 'queued'").run(cutoff);
      return { links: old.length, events: Number(ev.changes) };
    });
  }
}

function rowClient(r: Row): ClientInfo {
  return {
    app: r.app as ClientInfo["app"],
    id: String(r.id),
    surface: r.surface as ClientInfo["surface"],
    cwd: (r.cwd as string) ?? null,
    title: (r.title as string) ?? null,
    hostId: (r.host_id as string) ?? null,
    firstSeen: Number(r.first_seen),
    lastSeen: Number(r.last_seen),
    listenerAt: r.listener_at == null ? null : Number(r.listener_at),
  };
}

function rowLink(r: Row): Link {
  return {
    id: String(r.id),
    kind: r.kind as Link["kind"],
    reviewKind: (r.review_kind as Link["reviewKind"]) ?? null,
    status: r.status as Link["status"],
    requester: epParse(r.requester)!,
    reviewer: epParse(r.reviewer),
    joinCode: (r.join_code as string) ?? null,
    delivery: r.delivery as Link["delivery"],
    round: Number(r.round),
    paths: JSON.parse(String(r.paths)),
    title: String(r.title),
    ownInitiative: !!r.own_initiative,
    fingerprints: JSON.parse(String(r.fingerprints)),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    closedAt: r.closed_at == null ? null : Number(r.closed_at),
    closeReason: (r.close_reason as string) ?? null,
  };
}

function rowMessage(r: Row): Message {
  return {
    id: String(r.id),
    linkId: (r.link_id as string) ?? null,
    kind: r.kind as Message["kind"],
    from: epParse(r.from_ep),
    to: epParse(r.to_ep),
    body: String(r.body),
    decision: r.decision ? (JSON.parse(String(r.decision)) as Decision) : null,
    round: Number(r.round),
    replyTo: (r.reply_to as string) ?? null,
    state: r.state as Message["state"],
    channel: (r.channel as Message["channel"]) ?? null,
    attempts: Number(r.attempts),
    error: (r.error as string) ?? null,
    deferredUntil: r.deferred_until == null ? null : Number(r.deferred_until),
    deferReason: (r.defer_reason as string) ?? null,
    bytes: Number(r.bytes),
    createdAt: Number(r.created_at),
    deliveredAt: r.delivered_at == null ? null : Number(r.delivered_at),
    answeredAt: r.answered_at == null ? null : Number(r.answered_at),
    clientId: (r.client_id as string) ?? null,
  };
}

function rowEvent(r: Row): BridgeEvent {
  return {
    id: Number(r.id),
    ts: Number(r.ts),
    type: String(r.type),
    linkId: (r.link_id as string) ?? null,
    messageId: (r.message_id as string) ?? null,
    actor: (r.actor as string) ?? null,
    bytes: Number(r.bytes),
    data: JSON.parse(String(r.data)),
  };
}

export { epParse, epStr };
