// The broker process: one per user. HTTP on 127.0.0.1 with a token, serving
// (1) the RPC the MCP servers call, (2) the dashboard API with a live event
// stream (SSE), and (3) the dashboard itself. It also drains the hooks'
// outbox and runs the delivery loop.

import "../shared/quiet.js";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { Store } from "../core/store.js";
import { Bridge, BridgeError, type Caller, type HookRecord } from "./bridge.js";
import { ensureDirs, paths, writeAtomic } from "../shared/paths.js";
import { loadConfig, loadRules, saveConfig, saveRules, DEFAULT_CONFIG } from "../shared/config.js";
import { now, randomToken } from "../shared/util.js";
import type { BridgeEvent } from "../shared/types.js";
import { VERSION } from "../version.js";

const DASHBOARD_DIR = path.resolve(import.meta.dirname, "../../dashboard");

export function brokerToken(): string {
  try {
    const t = fs.readFileSync(paths.token(), "utf8").trim();
    if (t.length >= 32) return t;
  } catch {
    /* create below */
  }
  const t = randomToken(32);
  writeAtomic(paths.token(), t, 0o600);
  return t;
}

const RANGES: Record<string, number> = { "1h": 3600_000, "6h": 6 * 3600_000, "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 };
const BUCKETS: Record<string, number> = { "1h": 60_000, "6h": 5 * 60_000, "24h": 30 * 60_000, "7d": 3 * 3600_000, "30d": 12 * 3600_000 };

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface BrokerHandle {
  server: http.Server;
  store: Store;
  bridge: Bridge;
  port: number;
  token: string;
  close(): Promise<void>;
}

export async function startBroker(opts: { port?: number; dbFile?: string; quietExit?: boolean } = {}): Promise<BrokerHandle> {
  ensureDirs();
  const cfg = loadConfig();
  const port = opts.port ?? cfg.port;
  const token = brokerToken();
  const store = new Store(opts.dbFile ?? paths.db());
  const bridge = new Bridge(store);
  const sse = new Set<http.ServerResponse>();
  store.onEvent((e) => broadcast(sse, e));

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      const status = e instanceof HttpError ? e.status : e instanceof BridgeError ? 400 : 500;
      if (!(e instanceof HttpError) && !(e instanceof BridgeError)) bridge.log("http", e);
      if (!res.headersSent) json(res, status, { error: (e as Error).message });
      else res.end();
    });
  });
  server.requestTimeout = 0; // review RPCs may wait minutes for an answer
  server.headersTimeout = 30_000;
  server.keepAliveTimeout = 5_000;

  const authorized = (req: http.IncomingMessage) => {
    const h = req.headers.authorization;
    if (h === `Bearer ${token}`) return true;
    const cookie = /(?:^|;\s*)bab_session=([a-f0-9]+)/.exec(req.headers.cookie ?? "")?.[1];
    return cookie === token;
  };
  const hostOk = (req: http.IncomingMessage) => {
    // DNS-rebinding guard: only our own loopback names
    const host = (req.headers.host ?? "").toLowerCase();
    return host === `127.0.0.1:${actualPort}` || host === `localhost:${actualPort}`;
  };
  let actualPort = port;

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${actualPort}`);
    const p = url.pathname;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (!hostOk(req)) throw new HttpError(421, "wrong host");
    if (p === "/api/health") return json(res, 200, { ok: true, version: VERSION, pid: process.pid, startedAt, port: actualPort });
    if (p === "/auth") {
      if (url.searchParams.get("token") !== token) throw new HttpError(401, "bad token");
      res.writeHead(302, { "Set-Cookie": `bab_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`, Location: "/" });
      return res.end();
    }
    if (!p.startsWith("/api/") && !p.startsWith("/rpc")) return serveStatic(req, res, p, authorized(req));
    if (!authorized(req)) throw new HttpError(401, "unauthorized: open the dashboard from the menu-bar app or with `blueai ui`");
    if (req.method !== "GET" && req.headers.origin && req.headers.origin !== `http://127.0.0.1:${actualPort}` && req.headers.origin !== `http://localhost:${actualPort}`)
      throw new HttpError(403, "cross-origin request refused");

    if (p === "/rpc" && req.method === "POST") return rpc(req, res);
    if (p === "/hook" && req.method === "POST") {
      await bridge.handleHook((await body(req)) as HookRecord);
      return json(res, 200, { ok: true });
    }
    return api(req, res, url);
  }

  async function rpc(req: http.IncomingMessage, res: http.ServerResponse) {
    const { op, caller, args } = (await body(req)) as { op: string; caller: Caller; args: Record<string, unknown> };
    if (!caller?.app || !caller?.id) throw new HttpError(400, "caller identity missing");
    const a = (args ?? {}) as never;
    let out;
    switch (op) {
      case "hello":
        out = { text: "ok", data: bridge.hello(caller) as unknown as Record<string, unknown> };
        break;
      case "ask":
        out = await bridge.ask(caller, a);
        break;
      case "review":
        out = await bridge.review(caller, a);
        break;
      case "advise":
        out = bridge.advise(caller, a);
        break;
      case "send":
        out = await bridge.send(caller, a);
        break;
      case "receive":
        out = bridge.receive(caller, a);
        break;
      case "join":
        out = bridge.join(caller, a);
        break;
      case "auto":
        out = await bridge.auto(caller, a);
        break;
      case "status":
        out = await bridge.status(caller);
        break;
      case "unlink":
        out = bridge.unlink(caller, a);
        break;
      case "read_chat": {
        const { readChat } = await import("../chats/index.js");
        out = await readChat(caller, a, { reviewers: bridge.buildView().reviewers, allowReviewers: loadConfig().readChatsInReviewers === "allow" });
        store.event("chat.read", { actor: `${caller.app}:${caller.id}`, data: { app: (a as { app?: string }).app ?? null, name: (a as { name?: string }).name ?? null } });
        break;
      }
      default:
        throw new HttpError(404, `unknown op ${op}`);
    }
    store.event("tool.call", { actor: `${caller.app}:${caller.id}`, data: { op } });
    return json(res, 200, out);
  }

  async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const p = url.pathname;
    const q = (k: string) => url.searchParams.get(k) ?? undefined;
    const range = q("range") && RANGES[q("range")!] ? q("range")! : "24h";
    const since = now() - RANGES[range];
    const m = (re: RegExp) => re.exec(p);
    let mm: RegExpExecArray | null;

    if (req.method === "GET") {
      if (p === "/api/summary") return json(res, 200, { range, ...store.summary(since), version: VERSION, startedAt, config: loadConfig() });
      if (p === "/api/series") return json(res, 200, { range, bucketMs: BUCKETS[range], points: store.series(since, BUCKETS[range]) });
      if (p === "/api/links")
        return json(res, 200, {
          links: store.links({ status: q("status")?.split(",").filter(Boolean), kind: q("kind"), search: q("q"), limit: Number(q("limit") ?? 100), offset: Number(q("offset") ?? 0) }).map((l) => ({
            ...l,
            messageCount: store.messages({ linkId: l.id, limit: 1000 }).length,
            lastMessage: store.messages({ linkId: l.id, limit: 1 })[0] ?? null,
          })),
        });
      if ((mm = m(/^\/api\/links\/(L\d+)$/))) {
        const link = store.link(mm[1]);
        if (!link) throw new HttpError(404, "no such link");
        return json(res, 200, { link, messages: store.messages({ linkId: link.id, order: "asc", limit: 2000 }), events: store.events({ linkId: link.id, limit: 500 }).reverse(), requester: store.client(link.requester), reviewer: link.reviewer ? store.client(link.reviewer) : null });
      }
      if (p === "/api/messages")
        return json(res, 200, {
          messages: store.messages({
            state: q("state")?.split(",").filter(Boolean) as never,
            kind: q("kind")?.split(",").filter(Boolean) as never,
            since: q("since") ? Number(q("since")) : since,
            search: q("q"),
            limit: Number(q("limit") ?? 200),
            offset: Number(q("offset") ?? 0),
          }),
        });
      if ((mm = m(/^\/api\/messages\/(M\d+)$/))) {
        const msg = store.message(mm[1]);
        if (!msg) throw new HttpError(404, "no such message");
        return json(res, 200, { message: msg, events: store.events({ limit: 200 }).filter((e) => e.messageId === msg.id).reverse() });
      }
      if (p === "/api/events") return json(res, 200, { events: store.events({ afterId: q("afterId") ? Number(q("afterId")) : undefined, type: q("type"), linkId: q("link"), since: q("since") ? Number(q("since")) : undefined, limit: Number(q("limit") ?? 300) }) });
      if (p === "/api/stream") return stream(req, res, url);
      if (p === "/api/clients") return json(res, 200, { clients: store.clients().map((c) => ({ ...c, listening: c.app === "claude" && c.surface !== "headless" ? bridge.listening(c) : null, auto: store.auto(c) })) });
      if (p === "/api/autos") return json(res, 200, { autos: store.autos() });
      if (p === "/api/config") return json(res, 200, { config: loadConfig(), defaults: DEFAULT_CONFIG, file: paths.config() });
      if (p === "/api/rules") return json(res, 200, { rules: loadRules(), file: paths.rules() });
      if (p === "/api/limits") return json(res, 200, { limits: await bridge.cachedLimits().catch(() => null) });
      if (p === "/api/install") {
        const { installStatus } = await import("../install/installer.js");
        return json(res, 200, await installStatus());
      }
      if (p === "/api/doctor") {
        const { runDoctor } = await import("../install/doctor.js");
        return json(res, 200, await runDoctor({ brokerUp: true }));
      }
      if (p === "/api/chats") {
        const { listChats } = await import("../chats/index.js");
        return json(res, 200, await listChats({ app: q("app") as never, query: q("q"), limit: Number(q("limit") ?? 50) }));
      }
      if ((mm = m(/^\/api\/chats\/(claude|codex)\/([A-Za-z0-9_.:-]+)$/))) {
        const { chatPage } = await import("../chats/index.js");
        return json(res, 200, await chatPage(mm[1] as never, mm[2], { cursor: q("cursor"), includeTools: q("tools") === "1" }));
      }
      if (p === "/api/export") return exportData(res, url, since);
    }
    if (req.method === "POST" || req.method === "PUT") {
      const b = (await body(req)) as Record<string, unknown>;
      if (p === "/api/config") {
        try {
          const config = saveConfig(b);
          store.event("config.updated", { data: { keys: Object.keys(b) } });
          return json(res, 200, { config });
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
      }
      if (p === "/api/rules") {
        try {
          saveRules(String(b.rules ?? ""));
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
        store.event("rules.updated", { data: { chars: String(b.rules ?? "").length } });
        return json(res, 200, { rules: loadRules() });
      }
      if ((mm = m(/^\/api\/links\/(L\d+)\/close$/))) {
        const link = store.link(mm[1]);
        if (!link) throw new HttpError(404, "no such link");
        bridge.closeLink(link, "closed from the dashboard");
        bridge.scheduleView();
        return json(res, 200, { link: store.link(link.id) });
      }
      if ((mm = m(/^\/api\/messages\/(M\d+)\/retry$/))) {
        const msg = store.message(mm[1]);
        if (!msg) throw new HttpError(404, "no such message");
        if (!["failed", "deferred"].includes(msg.state)) throw new HttpError(409, `message is ${msg.state}`);
        store.updateMessage(msg.id, { state: "pending", deferredUntil: null, error: null, attempts: 0 });
        store.event("message.retry", { messageId: msg.id, linkId: msg.linkId, actor: "dashboard" });
        bridge.deliver(msg.id).catch(() => {});
        return json(res, 200, { message: store.message(msg.id) });
      }
      if ((mm = m(/^\/api\/autos\/(.+)\/off$/))) {
        const key = decodeURIComponent(mm[1]);
        const a = store.autos().find((x) => x.key === key);
        if (!a) throw new HttpError(404, "no such auto mode");
        await bridge.auto({ ...a.owner }, { on: false });
        return json(res, 200, { ok: true });
      }
      if (p === "/api/install") {
        const { runInstall } = await import("../install/installer.js");
        const target = String(b.target ?? "all") as never;
        const action = b.action === "uninstall" ? "uninstall" : "install";
        const result = await runInstall(action, target);
        store.event(`install.${action}`, { actor: "dashboard", data: { target, ok: result.ok } });
        return json(res, 200, result);
      }
      if (p === "/api/maintenance/prune") {
        const r = store.prune(loadConfig().retentionDays * 86_400_000);
        store.event("maintenance.prune", { data: r });
        return json(res, 200, r);
      }
      if (p === "/api/maintenance/tick") {
        await bridge.tick();
        return json(res, 200, { ok: true });
      }
    }
    throw new HttpError(404, "not found");
  }

  function stream(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
    res.write(`retry: 2000\n\n`);
    const after = Number(url.searchParams.get("afterId") ?? req.headers["last-event-id"] ?? 0);
    if (after) for (const e of store.events({ afterId: after, limit: 1000 }).reverse()) res.write(sseFrame(e));
    sse.add(res);
    const ping = setInterval(() => res.write(`: ping ${now()}\n\n`), 15_000);
    req.on("close", () => {
      clearInterval(ping);
      sse.delete(res);
    });
  }

  function exportData(res: http.ServerResponse, url: URL, since: number) {
    const what = url.searchParams.get("what") === "events" ? "events" : "messages";
    const fmt = url.searchParams.get("format") === "json" ? "json" : "csv";
    const rows: Record<string, unknown>[] =
      what === "events"
        ? store.events({ since, limit: 5000 }).map((e) => ({ ...e, data: JSON.stringify(e.data) }))
        : store.messages({ since, limit: 5000 }).map((m) => ({
            id: m.id,
            link: m.linkId,
            kind: m.kind,
            from: m.from ? `${m.from.app}:${m.from.id}` : "bridge",
            to: m.to ? `${m.to.app}:${m.to.id}` : "",
            state: m.state,
            channel: m.channel,
            decision: m.decision?.decision ?? "",
            round: m.round,
            bytes: m.bytes,
            created: new Date(m.createdAt).toISOString(),
            delivered: m.deliveredAt ? new Date(m.deliveredAt).toISOString() : "",
            latencyMs: m.deliveredAt ? m.deliveredAt - m.createdAt : "",
            error: m.error ?? "",
          }));
    const name = `blueaibridge-${what}-${new Date().toISOString().slice(0, 10)}.${fmt}`;
    res.writeHead(200, { "Content-Type": fmt === "json" ? "application/json" : "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` });
    if (fmt === "json") return res.end(JSON.stringify(rows, null, 2));
    const cols = rows.length ? Object.keys(rows[0]) : [];
    const cell = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    res.end([cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n"));
  }

  // ---------- outbox (hooks) ----------
  let draining = false;
  async function drainOutbox() {
    if (draining) return;
    draining = true;
    try {
      let files: string[] = [];
      try {
        files = fs.readdirSync(paths.outbox()).filter((f) => f.endsWith(".json")).sort();
      } catch {
        return;
      }
      for (const f of files) {
        const full = path.join(paths.outbox(), f);
        let rec: HookRecord | null = null;
        try {
          rec = JSON.parse(fs.readFileSync(full, "utf8"));
        } catch {
          /* half-written or garbage: drop it if old */
          try {
            if (Date.now() - fs.statSync(full).mtimeMs > 10_000) fs.rmSync(full, { force: true });
          } catch {
            /* gone */
          }
          continue;
        }
        fs.rmSync(full, { force: true });
        if (rec?.app && rec?.session && rec?.type) await bridge.handleHook(rec).catch((e) => bridge.log("hook", e));
      }
    } finally {
      draining = false;
    }
  }

  // ---------- loops ----------
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await drainOutbox();
      await bridge.tick();
    } catch (e) {
      bridge.log("tick", e);
    } finally {
      ticking = false;
    }
  };
  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(paths.outbox(), () => void drainOutbox());
  } catch {
    /* polling below */
  }
  const outboxTimer = setInterval(() => void drainOutbox(), 1000);
  const tickTimer = setInterval(() => void tick(), Number(process.env.BLUE_AI_BRIDGE_TICK_MS ?? 5000));
  const pruneTimer = setInterval(() => {
    try {
      store.prune(loadConfig().retentionDays * 86_400_000);
    } catch (e) {
      bridge.log("prune", e);
    }
  }, 6 * 3600_000);
  const startedAt = now();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  actualPort = (server.address() as { port: number }).port;
  writeAtomic(paths.port(), String(actualPort));
  writeAtomic(paths.pid(), String(process.pid));
  bridge.writeView();
  for (const c of store.clients()) bridge.syncInbox(c);
  store.event("broker.started", { data: { pid: process.pid, port: actualPort, version: VERSION } });
  void tick();

  return {
    server,
    store,
    bridge,
    port: actualPort,
    token,
    async close() {
      clearInterval(outboxTimer);
      clearInterval(tickTimer);
      clearInterval(pruneTimer);
      watcher?.close();
      for (const r of sse) r.end();
      await new Promise<void>((r) => server.close(() => r()));
      server.closeAllConnections?.();
      store.event("broker.stopped", { data: { pid: process.pid } });
      store.close();
      try {
        if (fs.readFileSync(paths.pid(), "utf8").trim() === String(process.pid)) fs.rmSync(paths.pid(), { force: true });
      } catch {
        /* not ours */
      }
    },
  };
}

function broadcast(sse: Set<http.ServerResponse>, e: BridgeEvent) {
  const frame = sseFrame(e);
  for (const r of sse) r.write(frame);
}
const sseFrame = (e: BridgeEvent) => `id: ${e.id}\nevent: bridge\ndata: ${JSON.stringify(e)}\n\n`;

function json(res: http.ServerResponse, status: number, data: unknown) {
  const s = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(s);
}

async function body(req: http.IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 8 << 20) throw new HttpError(413, "request too large");
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, p: string, authed: boolean) {
  if (!authed) {
    res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(`<!doctype html><meta charset="utf-8"><title>BlueAIBridge</title><body style="font:15px system-ui;padding:48px;color:#1e293b"><h2>BlueAIBridge</h2><p>Open the dashboard from the menu-bar app, or run <code>blueai ui</code>.</p></body>`);
  }
  const rel = decodeURIComponent(p).replace(/^\/+/, "") || "index.html";
  let file = path.resolve(DASHBOARD_DIR, rel);
  if (!file.startsWith(DASHBOARD_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DASHBOARD_DIR, "index.html");
  if (!fs.existsSync(file)) {
    res.writeHead(503, { "Content-Type": "text/plain" });
    return res.end("Dashboard not built: run `npm run build`.");
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=31536000, immutable",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  });
  fs.createReadStream(file).pipe(res);
}
