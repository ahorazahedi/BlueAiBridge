// Drive ChatGPT Desktop's threads through its bundled `codex app-server`
// (JSON-RPC over stdio, experimental API). A private app-server shares the
// app's state, so a prompt queued here is run by the desktop app, in the
// visible chat. An unloaded thread needs codex://threads/wake/<id>.
// Never keep a thread loaded in the private server: it would run the turn
// itself, headless. Each call uses a fresh, short-lived server.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { locateCodex, openUrl } from "../shared/platform.js";
import { paths } from "../shared/paths.js";

/** Whether ~/.codex/config.toml registers BlueAIBridge (so it can be switched off for child processes). */
export function codexHasBridge(): boolean {
  try {
    return /^\[mcp_servers\.blue_ai_bridge\]/m.test(fs.readFileSync(path.join(paths.codexHome(), "config.toml"), "utf8"));
  } catch {
    return false;
  }
}

const RPC_MS = 60_000;

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

export class AppServer {
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private closed = false;
  readonly proc: ChildProcessWithoutNullStreams;

  static async open(timeoutMs = RPC_MS): Promise<AppServer> {
    const bin = locateCodex();
    if (!bin) throw new Error("ChatGPT Desktop's codex CLI was not found (set BLUE_AI_BRIDGE_CODEX_BIN)");
    const s = new AppServer(bin.path);
    try {
      await s.rpc("initialize", { clientInfo: { name: "blue-ai-bridge", version: "1.0.0" }, capabilities: { experimentalApi: true } }, timeoutMs);
      s.notify("initialized");
      return s;
    } catch (e) {
      s.close();
      throw e;
    }
  }

  private constructor(bin: string) {
    // without our own MCP server: one spawned here would die with this process.
    // (Only when it is configured: overriding a server that doesn't exist is a config error.)
    const args = codexHasBridge() ? ["-c", "mcp_servers.blue_ai_bridge.enabled=false", "app-server"] : ["app-server"];
    this.proc = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, BLUE_AI_BRIDGE_CHILD: "1" } });
    const gone = (why: string) => {
      this.closed = true;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error(`codex app-server ${why}`));
      }
      this.pending.clear();
    };
    this.proc.on("exit", (code, signal) => gone(`exited (${signal ?? code})`));
    this.proc.on("error", (e) => gone(`failed to start (${e.message})`));
    this.proc.stdin.on("error", () => {});
    this.proc.stderr.on("data", () => {});
    readline.createInterface({ input: this.proc.stdout }).on("line", (line) => {
      let m: { id?: number; result?: unknown; error?: { message?: string; code?: number } };
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      if (m.id == null) return;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.reject(new RpcError(m.error.message ?? JSON.stringify(m.error), m.error.code));
      else p.resolve(m.result);
    });
  }

  rpc<T = unknown>(method: string, params: unknown, timeoutMs = RPC_MS): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error("codex app-server is closed"));
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`codex app-server didn't answer ${method} within ${timeoutMs / 1000} s`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.proc.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }

  notify(method: string, params?: unknown) {
    this.proc.stdin.write(JSON.stringify({ method, ...(params !== undefined && { params }) }) + "\n");
  }

  close() {
    this.closed = true;
    try {
      this.proc.stdin.end();
    } catch {
      /* gone */
    }
    this.proc.kill();
  }
}

export async function withServer<T>(fn: (s: AppServer) => Promise<T>, deadlineMs = RPC_MS): Promise<T> {
  const s = await AppServer.open(deadlineMs);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(s),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer from ChatGPT Desktop within ${deadlineMs / 1000} s`)), deadlineMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    s.close();
  }
}

// ---------- models ----------

export interface CodexModel {
  id?: string;
  model: string;
  displayName?: string;
  hidden?: boolean;
  supportedReasoningEfforts?: { reasoningEffort: string }[];
}

export class ModelChoiceError extends Error {}

const unsupported = (e: unknown) => e instanceof RpcError && (e.code === -32601 || /unknown variant|method not found|unknown method/i.test(e.message));

export async function listModels(s: AppServer): Promise<CodexModel[] | null> {
  const out: CodexModel[] = [];
  let cursor: string | null = null;
  try {
    do {
      const r: { data?: CodexModel[]; nextCursor?: string | null } = await s.rpc("model/list", { includeHidden: true, ...(cursor && { cursor }) });
      if (!Array.isArray(r?.data)) throw new Error("unexpected answer");
      out.push(...r.data);
      cursor = r.nextCursor ?? null;
    } while (cursor);
  } catch (e) {
    if (!out.length && unsupported(e)) return null;
    throw new ModelChoiceError(`Nothing was created: ChatGPT's model list couldn't be read (${(e as Error).message}).`);
  }
  return out;
}

const norm = (s: unknown) => (typeof s === "string" ? s.trim().toLowerCase().replace(/\s+/g, "-") : "");

/** Resolve a model by id or picker name; refuse unknown models/efforts with the list. */
export function pickModel(models: CodexModel[] | null, model?: string, effort?: string): string | undefined {
  if (!models || !model) return model || undefined;
  const m = models.find((x) => [x.id, x.model, x.displayName].some((n) => norm(n) === norm(model)));
  if (!m) {
    const names = models.filter((x) => !x.hidden).map((x) => `${x.model}${x.displayName ? ` (${x.displayName})` : ""}`);
    throw new ModelChoiceError(`Nothing was created: ChatGPT has no model "${model}". Its models: ${names.join(", ")}.`);
  }
  const efforts = (m.supportedReasoningEfforts ?? []).map((e) => e.reasoningEffort);
  if (effort && efforts.length && !efforts.includes(effort)) throw new ModelChoiceError(`Nothing was created: ${m.model} has no effort "${effort}". Its efforts: ${efforts.join(", ")}.`);
  return m.model;
}

// ---------- threads ----------

/** Create a named, visible ChatGPT thread without running a turn. */
export async function createThread(opts: { cwd: string; name?: string; model?: string; effort?: string; readOnly?: boolean; seed?: string }) {
  if (process.env.BLUE_AI_BRIDGE_FAKE_CODEX) return { threadId: crypto.randomUUID(), model: opts.model ?? "fake" };
  return withServer(async (s) => {
    const model = opts.model ? pickModel(await listModels(s), opts.model, opts.effort) : undefined;
    const r: { thread: { id: string }; model?: string } = await s.rpc("thread/start", {
      model: model ?? null,
      cwd: opts.cwd,
      sandbox: opts.readOnly === false ? null : "read-only",
      ...(opts.effort && { config: { model_reasoning_effort: opts.effort } }),
    });
    const threadId = r.thread.id;
    if (opts.effort) await s.rpc("thread/settings/update", { threadId, effort: opts.effort }).catch(() => {});
    // a thread without items isn't persisted: inject the bridge's note
    await s.rpc("thread/inject_items", {
      threadId,
      items: [{ type: "message", role: "developer", content: [{ type: "input_text", text: opts.seed ?? "This chat is a BlueAIBridge reviewer chat." }] }],
    });
    if (opts.name) await s.rpc("thread/name/set", { threadId, name: opts.name }).catch(() => {});
    return { threadId, model: r.model ?? model ?? null };
  });
}

/** Queue a prompt in a thread's own queue and wake the desktop app to run it. */
export async function queuePrompt(threadId: string, prompt: string, opts: { wake?: boolean; clientId?: string } = {}) {
  const clientId = opts.clientId ?? crypto.randomUUID();
  if (process.env.BLUE_AI_BRIDGE_FAKE_CODEX) {
    fs.appendFileSync(path.join(paths.data(), "fake-codex-queue.jsonl"), JSON.stringify({ threadId, prompt, clientId }) + "\n");
    return { clientId };
  }
  await withServer(async (s) => {
    await s.rpc("thread/queue/add", { threadId, input: [{ type: "text", text: prompt }], clientUserMessageId: clientId });
  });
  if (opts.wake !== false) openUrl(`codex://threads/wake/${threadId}`);
  return { clientId };
}

export interface Limits {
  blocked: boolean;
  resetsAt: number | null;
  primary: { usedPercent: number; resetsAt: number | null } | null;
  secondary: { usedPercent: number; resetsAt: number | null } | null;
  credits: boolean;
}

type Window = { usedPercent: number; resetsAt?: number | null };
export function summarizeLimits(r: {
  rateLimitsByLimitId?: Record<string, unknown>;
  rateLimits?: unknown;
  ordinaryUsageAllowed?: boolean;
} | null): Limits {
  const snap = ((r?.rateLimitsByLimitId as Record<string, unknown> | undefined)?.codex ?? r?.rateLimits ?? null) as {
    primary?: Window;
    secondary?: Window;
    credits?: { hasCredits?: boolean; unlimited?: boolean };
  } | null;
  const credits = !!(snap?.credits?.hasCredits || snap?.credits?.unlimited);
  const win = (w?: Window) => (w ? { usedPercent: w.usedPercent, resetsAt: w.resetsAt ? w.resetsAt * 1000 : null } : null);
  const full = [snap?.primary, snap?.secondary].filter((w): w is Window => !!w && w.usedPercent >= 100 && !!w.resetsAt);
  return {
    blocked: r?.ordinaryUsageAllowed === false && !credits,
    resetsAt: full.length ? Math.max(...full.map((w) => w.resetsAt as number)) * 1000 : null,
    primary: win(snap?.primary),
    secondary: win(snap?.secondary),
    credits,
  };
}

export async function readLimits(timeoutMs = 8000): Promise<Limits> {
  if (process.env.BLUE_AI_BRIDGE_FAKE_CODEX) {
    try {
      return summarizeLimits(JSON.parse(fs.readFileSync(path.join(paths.data(), "fake-limits.json"), "utf8")));
    } catch {
      return summarizeLimits({});
    }
  }
  return withServer((s) => s.rpc("account/rateLimits/read", null, timeoutMs).then((r) => summarizeLimits(r as never)), timeoutMs);
}
