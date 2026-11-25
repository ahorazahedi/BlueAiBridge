/* eslint-disable @typescript-eslint/no-explicit-any */
// End to end over real processes: a broker, MCP servers for both sides
// speaking JSON-RPC over stdio, and the HTTP API the dashboard uses.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import http from "node:http";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import { setupEnv, makeRepo, fakeAgent } from "./helpers.js";
const { root } = setupEnv();
const { startBroker } = await import("../src/broker/http.js");
const h = await startBroker({ port: 0 });
process.env.BLUE_AI_BRIDGE_PORT = String(h.port);
const base = `http://127.0.0.1:${h.port}`;
const auth = { Authorization: `Bearer ${h.token}` };
const { dir } = makeRepo(root, "e2e");
const CLI = path.resolve(import.meta.dirname, "../src/cli.js");

class Mcp {
  proc: ChildProcessWithoutNullStreams;
  seq = 0;
  waiting = new Map<number, (m: Record<string, unknown>) => void>();
  constructor(side: "claude" | "codex", env: Record<string, string> = {}) {
    this.proc = spawn(process.execPath, ["--no-warnings", CLI, "mcp", "--side", side], { cwd: dir, env: { ...process.env, ...env } });
    readline.createInterface({ input: this.proc.stdout }).on("line", (l) => {
      const m = JSON.parse(l);
      if (m.id != null) this.waiting.get(m.id)?.(m);
    });
  }
  call(method: string, params: unknown = {}) {
    const id = ++this.seq;
    return new Promise<Record<string, any>>((resolve) => {
      this.waiting.set(id, resolve);
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  tool(name: string, args: Record<string, unknown>, meta?: Record<string, unknown>) {
    return this.call("tools/call", { name, arguments: args, ...(meta && { _meta: meta }) }).then((r) => r.result as { content: { text: string }[]; isError?: boolean });
  }
}

const claude = new Mcp("claude", { CLAUDE_CODE_SESSION_ID: "e2e-claude", CLAUDE_CODE_ENTRYPOINT: "claude-desktop" });
const codex = new Mcp("codex");
after(async () => {
  claude.proc.kill();
  codex.proc.kill();
  await h.close();
});

test("MCP handshake and tool list", async () => {
  const init = await claude.call("initialize", { protocolVersion: "2025-06-18" });
  assert.equal(init.result.serverInfo.name, "blue-ai-bridge");
  const tools = (await claude.call("tools/list")).result.tools.map((t: { name: string }) => t.name);
  assert.deepEqual(tools.sort(), ["blue_advise", "blue_ask", "blue_auto", "blue_join", "blue_read_chat", "blue_receive", "blue_review", "blue_send", "blue_status", "blue_unlink"]);
});

test("Claude asks for a review, ChatGPT joins with the code and answers; the dashboard API sees it all", async () => {
  const r = await claude.tool("blue_review", { request: "Please review the auth refactor", reviewer: "join" });
  const code = /Join code: ([a-z2-9]{6})/.exec(r.content[0].text)![1];
  const j = await codex.tool("blue_join", { code }, { threadId: "01a2b3c4-0000-7000-8000-00000000e2e0" });
  assert.match(j.content[0].text, /Please review the auth refactor/);
  const reqId = /review request (M\d+)/.exec(j.content[0].text)![1];
  const a = await codex.tool("blue_advise", { request_id: reqId, decision: "changes_requested", note: "One issue.", blocking: ["token expiry uses < instead of <="] }, { threadId: "01a2b3c4-0000-7000-8000-00000000e2e0" });
  assert.ok(!a.isError, a.content[0].text);
  const links = (await (await fetch(`${base}/api/links`, { headers: auth })).json()) as any;
  const link = links.links.find((l: { title: string }) => /auth refactor/.test(l.title));
  const detail = (await (await fetch(`${base}/api/links/${link.id}`, { headers: auth })).json()) as any;
  const convo = detail.messages.filter((m: { kind: string }) => m.kind !== "notice");
  assert.equal(convo.length, 2);
  assert.equal(convo[1].decision.decision, "changes_requested");
  assert.ok(detail.events.some((e: { type: string }) => e.type === "link.joined"));
  // Claude isn't listening: its answer waits; blue_receive returns it
  const rec = await claude.tool("blue_receive", {});
  assert.match(rec.content[0].text, /token expiry uses < instead of <=/);
  assert.match(rec.content[0].text, new RegExp(`round_of: "${link.id}"`));
});

test("blue_ask from ChatGPT reaches Claude headless and returns inline", async () => {
  fakeAgent({ answer: "Claude here: yes, it's race-free." });
  const r = await codex.tool("blue_ask", { question: "Is this race-free?" }, { threadId: "01a2b3c4-0000-7000-8000-00000000e2e1" });
  assert.match(r.content[0].text, /Claude answered/);
  assert.match(r.content[0].text, /race-free/);
});

test("refuses calls from a chat the bridge started itself (no ping-pong)", async () => {
  const child = new Mcp("claude", { CLAUDE_CODE_SESSION_ID: "child", BLUE_AI_BRIDGE_CHILD: "1" });
  const r = await child.tool("blue_ask", { question: "loop?" });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /no ping-pong/);
  child.proc.kill();
});

test("HTTP API: auth, host check, summary, export, SSE", async () => {
  assert.equal((await fetch(`${base}/api/summary`)).status, 401);
  const status = await new Promise<number>((resolve) =>
    http.get({ host: "127.0.0.1", port: h.port, path: "/api/summary", headers: { ...auth, Host: "evil.example" } }, (r) => (r.resume(), resolve(r.statusCode!))),
  );
  assert.equal(status, 421, "DNS-rebinding guard");
  const s = (await (await fetch(`${base}/api/summary?range=24h`, { headers: auth })).json()) as any;
  assert.ok(s.messages >= 4);
  assert.ok(s.bytes > 0);
  const csv = await (await fetch(`${base}/api/export?what=messages&format=csv`, { headers: auth })).text();
  assert.match(csv.split("\n")[0], /^id,link,kind,from,to,state/);
  const login = await fetch(`${base}/auth?token=${h.token}`, { redirect: "manual" });
  assert.equal(login.status, 302);
  assert.match(login.headers.get("set-cookie")!, /bab_session=.*HttpOnly; SameSite=Strict/);
  // live stream delivers new events
  const ctl = new AbortController();
  const res = await fetch(`${base}/api/stream`, { headers: auth, signal: ctl.signal });
  const reader = res.body!.getReader();
  h.store.event("test.ping", { data: { hello: 1 } });
  let got = "";
  while (!got.includes("test.ping")) got += new TextDecoder().decode((await reader.read()).value);
  ctl.abort();
  assert.match(got, /event: bridge/);
  // dashboard served behind the cookie
  const page = await fetch(`${base}/`, { headers: { Cookie: `bab_session=${h.token}` } });
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy")!, /default-src 'self'/);
});

test("settings and rules round-trip through the API", async () => {
  const put = await fetch(`${base}/api/config`, { method: "PUT", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ maxRounds: 9 }) });
  assert.equal(((await put.json()) as any).config.maxRounds, 9);
  const bad = await fetch(`${base}/api/config`, { method: "PUT", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ delivery: "pigeon" }) });
  assert.equal(bad.status, 400);
  await fetch(`${base}/api/rules`, { method: "PUT", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ rules: "Answer in English." }) });
  assert.equal(((await (await fetch(`${base}/api/rules`, { headers: auth })).json()) as any).rules, "Answer in English.");
  const cross = await fetch(`${base}/api/rules`, { method: "PUT", headers: { ...auth, "Content-Type": "application/json", Origin: "http://evil.example" }, body: "{}" });
  assert.equal(cross.status, 403);
});
