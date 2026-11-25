// Hooks for Claude Code and Codex / ChatGPT Desktop (same contract: JSON on
// stdin, JSON or exit codes out). They never use the network (Codex may run
// them sandboxed): they read the broker's view file and their inbox file,
// and drop records into the outbox folder.
//
//   blueai hook --app claude|codex --event <event>
//   prompt    UserPromptSubmit: notes waiting for this chat, auto mode's rules, reminders, the user's rules; turn start (every-turn)
//   start     SessionStart: auto mode's full rules, reviews waiting for this chat's answer, notes
//   stop      Stop: turn end (every-turn reviews, reviewer verdict fallback); key-moment guard
//   listen    Claude, async (asyncRewake): wait for a message to this session and wake it (exit 2)
//   stopfail  Claude StopFailure: an API error ended the turn
//   permission Claude Notification(permission_prompt): a tool waits for the user's approval

import "../shared/quiet.js";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { App, AutoState, HookView } from "../shared/types.js";
import { paths, readJson, writeAtomic, fileKey, ensureDirs } from "../shared/paths.js";
import { rulesBlock } from "../shared/config.js";
import * as T from "../core/texts.js";
import { fingerprint, snapshot } from "../core/git.js";
import { sha256 } from "../shared/util.js";

const LISTEN_MAX_MS = Number(process.env.BLUE_AI_BRIDGE_LISTEN_MAX_S ?? 12 * 3600) * 1000;
const HOOK_BUDGET_MS = 6000;

interface HookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  prompt?: string;
  turn_id?: string;
  prompt_id?: string;
  last_assistant_message?: string;
  stop_hook_active?: boolean;
  source?: string;
  error?: unknown;
  error_message?: string;
  message?: string;
  notification_type?: string;
}

interface Inbox {
  wake: { id: string; text: string }[];
  notes: { id: string; text: string }[];
}

export async function runHook(app: App, event: string, rawInput?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const out = { code: 0, stdout: "", stderr: "" };
  if (process.env.BLUE_AI_BRIDGE_CHILD === "1") return out; // a chat the bridge itself started
  let input: HookInput = {};
  try {
    input = JSON.parse(rawInput ?? (await readStdin()) ?? "{}");
  } catch {
    return out;
  }
  if (!input.session_id) return out;
  ensureDirs();
  const key = `${app}:${input.session_id}`;
  const fk = fileKey(key);
  const view = readJson<HookView | null>(paths.view(), null);
  const auto: AutoState | undefined = view?.autos?.[key];
  const base = { app, session: input.session_id, cwd: input.cwd ?? null, surface: surfaceOf(app), hostId: app === "claude" ? (process.env.CLAUDE_CODE_HOST_SESSION_ID ?? null) : null };
  const t0 = Date.now();
  const budgetLeft = () => HOOK_BUDGET_MS - (Date.now() - t0);
  log({ app, event, session: input.session_id, keys: Object.keys(input) });

  switch (event) {
    case "prompt": {
      ensureBrokerRunning();
      const turnFile = path.join(paths.listeners(), fk + ".turn");
      const running = readJson<{ id: string; startedAt: number; running: boolean } | null>(turnFile, null);
      const incoming = input.turn_id ?? input.prompt_id ?? null;
      const midTurn = !!(running?.running && incoming && running.id === incoming);
      const turnId = midTurn ? running!.id : (incoming ?? `t${Date.now().toString(36)}`);
      if (!midTurn) writeAtomic(turnFile, JSON.stringify({ id: turnId, startedAt: Date.now(), running: true }));
      let snapshots: Record<string, { root: string; tree: string } | null> | undefined;
      if (auto?.everyTurn && !midTurn) snapshots = await snapshotAll(auto.paths, budgetLeft);
      outbox({ ...base, type: "prompt", turnId, userTurn: !midTurn, prompt: (input.prompt ?? "").slice(0, 20_000), snapshots });

      const ctx: string[] = [];
      const inbox = takeInbox(fk, key, true);
      if (inbox.length) ctx.push(...inbox);
      if (auto) {
        ctx.push(T.AUTO_RULES_SHORT(auto.reviewer ? (auto.reviewer.app === "claude" ? "Claude" : "ChatGPT") : "your reviewer", auto.everyTurn));
        if (!auto.everyTurn && auto.promptsSinceReview + 1 >= 5 && !(view?.openRequests?.[key]?.length)) ctx.push(T.REMINDER(auto.promptsSinceReview + 1));
        if (!auto.everyTurn && /\b(done|finished|complete|that's all|ship it)\b/i.test(input.prompt ?? "") && !auto.wrapUpOffered) ctx.push(T.WRAP_UP_OFFER);
      }
      const involved = inbox.length || auto || view?.reviewers?.includes(key) || view?.openRequests?.[key]?.length;
      const rules = involved ? rulesBlock() : "";
      if (ctx.length || rules) out.stdout = JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: (ctx.join("\n\n") + rules).trim() } });
      return out;
    }

    case "start": {
      ensureBrokerRunning();
      outbox({ ...base, type: "session_start", source: input.source ?? null });
      const ctx: string[] = [];
      if (auto) ctx.push(T.AUTO_RULES(auto.reviewer ? (auto.reviewer.app === "claude" ? "Claude" : "ChatGPT") : "your reviewer", auto.everyTurn));
      const waiting = view?.waitingReviews?.[key] ?? [];
      if (waiting.length)
        ctx.push(
          `[BlueAIBridge] This chat is a reviewer. Reviews waiting for its answer: ${waiting.map((w) => `${w.id} (link ${w.linkId}, round ${w.round}): ${w.summary}`).join("; ")}. ` +
            `Read each in full with blue_receive(id) and answer with blue_advise.`,
        );
      ctx.push(...takeInbox(fk, key, true));
      const rules = ctx.length ? rulesBlock() : "";
      if (ctx.length) out.stdout = JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: (ctx.join("\n\n") + rules).trim() } });
      return out;
    }

    case "stop": {
      const turnFile = path.join(paths.listeners(), fk + ".turn");
      const turn = readJson<{ id: string; startedAt: number; running: boolean } | null>(turnFile, null);
      if (turn) writeAtomic(turnFile, JSON.stringify({ ...turn, running: false }));
      const lastMessage = input.last_assistant_message ?? lastAssistantText(app, input.transcript_path);
      let snapshots: Record<string, { root: string; tree: string } | null> | undefined;
      if (auto?.everyTurn) snapshots = await snapshotAll(auto.paths, budgetLeft);
      const isReviewer = !!view?.waitingReviews?.[key]?.length;
      if (auto?.everyTurn || isReviewer)
        outbox({ ...base, type: "turn_end", turnId: turn?.id ?? input.turn_id ?? null, lastMessage: (lastMessage ?? "").slice(0, 30_000), snapshots, turnStartedAt: turn?.startedAt });

      // key moments: stop once per set of unapproved changes
      if (auto && !auto.everyTurn && !input.stop_hook_active && !(view?.openRequests?.[key]?.length)) {
        const changed: string[] = [];
        const fps: string[] = [];
        for (const p of auto.paths) {
          if (budgetLeft() < 500) break;
          let fp: string;
          try {
            fp = fs.existsSync(p) ? await fingerprint(p) : "gone";
          } catch {
            continue;
          }
          fps.push(`${p}=${fp}`);
          if (auto.approved[p] !== fp) changed.push(fp === "gone" ? `${p} (gone)` : p);
        }
        const combined = sha256(fps.join("\n"));
        const guardFile = path.join(paths.listeners(), fk + ".guard");
        const already = auto.guardedFor === combined || readFileSafe(guardFile) === combined;
        if (changed.length && !already) {
          fs.writeFileSync(guardFile, combined);
          outbox({ ...base, type: "guarded", fingerprint: combined, paths: changed });
          out.stdout = JSON.stringify({ decision: "block", reason: T.GUARD(changed) });
        }
      }
      return out;
    }

    case "stopfail": {
      const err = typeof input.error === "string" ? input.error : input.error_message ?? JSON.stringify(input.error ?? "API error");
      outbox({ ...base, type: "stop_failure", error: String(err).slice(0, 2000) });
      return out;
    }

    case "permission": {
      outbox({ ...base, type: "permission", message: (input.message ?? "").slice(0, 500) });
      return out;
    }

    case "listen": {
      if (app !== "claude") return out;
      ensureBrokerRunning();
      const me = `${process.pid}:${Date.now()}`;
      const ownerFile = path.join(paths.listeners(), fk + ".listener");
      const aliveFile = path.join(paths.listeners(), fk + ".alive");
      fs.writeFileSync(ownerFile, me);
      fs.writeFileSync(aliveFile, String(Date.now()));
      outbox({ ...base, type: "listening" });
      const pollMs = Number(process.env.BLUE_AI_BRIDGE_LISTEN_POLL_MS ?? 700);
      let lastBeat = Date.now();
      while (Date.now() - t0 < LISTEN_MAX_MS) {
        if (readFileSafe(ownerFile) !== me) return out; // a newer listener took over
        if (Date.now() - lastBeat > 15_000) {
          try {
            const now = new Date();
            fs.utimesSync(aliveFile, now, now);
          } catch {
            fs.writeFileSync(aliveFile, String(Date.now()));
          }
          lastBeat = Date.now();
        }
        const box = readJson<Inbox | null>(path.join(paths.inbox(), fk + ".json"), null);
        const consumed = consumedSet(fk);
        const wake = (box?.wake ?? []).filter((w) => !consumed.has(w.id));
        if (wake.length) {
          markConsumed(fk, wake.map((w) => w.id));
          outbox({ ...base, type: "ack", ids: wake.map((w) => w.id), how: "wake" });
          out.stderr = wake.map((w) => w.text).join("\n\n");
          out.code = 2;
          return out;
        }
        await new Promise((r) => setTimeout(r, pollMs));
      }
      return out;
    }
  }
  return out;
}

/** Notes (and any wake the listener missed) for the next prompt; acknowledged so they come once. */
function takeInbox(fk: string, key: string, includeWake: boolean): string[] {
  const box = readJson<Inbox | null>(path.join(paths.inbox(), fk + ".json"), null);
  if (!box) return [];
  const consumed = consumedSet(fk);
  const notes = box.notes.filter((n) => !consumed.has(n.id));
  const wake = includeWake ? box.wake.filter((w) => !consumed.has(w.id)) : [];
  const all = [...wake, ...notes];
  if (!all.length) return [];
  markConsumed(fk, all.map((x) => x.id));
  const [app, ...rest] = key.split(":");
  if (notes.length) outbox({ app: app as App, session: rest.join(":"), type: "ack", ids: notes.map((n) => n.id), how: "note" });
  if (wake.length) outbox({ app: app as App, session: rest.join(":"), type: "ack", ids: wake.map((n) => n.id), how: "wake" });
  return all.map((x) => x.text);
}

function consumedSet(fk: string): Set<string> {
  return new Set(readJson<string[]>(path.join(paths.listeners(), fk + ".consumed"), []));
}
function markConsumed(fk: string, ids: string[]) {
  const file = path.join(paths.listeners(), fk + ".consumed");
  const list = [...readJson<string[]>(file, []), ...ids].slice(-500);
  writeAtomic(file, JSON.stringify(list));
}

let seq = 0;
function outbox(rec: Record<string, unknown>) {
  try {
    const name = `${Date.now()}-${process.pid}-${seq++}-${Math.random().toString(36).slice(2, 8)}.json`;
    writeAtomic(path.join(paths.outbox(), name), JSON.stringify(rec));
  } catch (e) {
    log({ error: `outbox: ${(e as Error).message}` });
  }
}

async function snapshotAll(list: string[], budgetLeft: () => number) {
  const out: Record<string, { root: string; tree: string } | null> = {};
  for (const p of list) {
    if (budgetLeft() < 800) {
      out[p] = null;
      continue;
    }
    try {
      out[p] = await snapshot(p);
    } catch {
      out[p] = null;
    }
  }
  return out;
}

function surfaceOf(app: App): "desktop" | "cli" | "unknown" {
  if (app === "claude") return process.env.CLAUDE_CODE_ENTRYPOINT === "claude-desktop" ? "desktop" : "cli";
  return "unknown";
}

/** The final assistant text of the turn, from the transcript, when the hook input doesn't carry it. */
export function lastAssistantText(app: App, transcript?: string): string | null {
  if (!transcript) return null;
  let text: string;
  try {
    const fd = fs.openSync(transcript, "r");
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 2 * 1024 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    text = buf.toString("utf8");
  } catch {
    return null;
  }
  const lines = text.split("\n").reverse();
  for (const line of lines) {
    let r: Record<string, unknown>;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (app === "claude" && r.type === "assistant") {
      const c = (r.message as { content?: { type: string; text?: string }[] })?.content;
      const t = Array.isArray(c) ? c.filter((x) => x.type === "text").map((x) => x.text).join("\n") : "";
      if (t.trim()) return t;
    }
    if (app === "codex") {
      const p = r.payload as Record<string, unknown> | undefined;
      if (r.type === "event_msg" && p?.type === "task_complete" && typeof p.last_agent_message === "string") return p.last_agent_message;
    }
  }
  return null;
}

function readFileSafe(f: string): string | null {
  try {
    return fs.readFileSync(f, "utf8").trim();
  } catch {
    return null;
  }
}

/** Start the broker when it isn't running, without waiting (hooks never use the network). */
function ensureBrokerRunning() {
  if (process.env.BLUE_AI_BRIDGE_NO_AUTOSTART) return;
  try {
    const pid = Number(fs.readFileSync(paths.pid(), "utf8").trim());
    if (pid > 0) {
      process.kill(pid, 0);
      return;
    }
  } catch {
    /* not running */
  }
  try {
    const cli = path.resolve(import.meta.dirname, "../cli.js");
    const log = fs.openSync(paths.brokerLog(), "a");
    const child = spawn(process.execPath, ["--no-warnings", cli, "broker"], { detached: true, stdio: ["ignore", log, log], env: { ...process.env, BLUE_AI_BRIDGE_CHILD: "" }, cwd: paths.root() });
    child.unref();
  } catch {
    /* the MCP server starts it too */
  }
}

function log(entry: Record<string, unknown>) {
  try {
    if (!fs.existsSync(path.join(paths.data(), "debug-hooks"))) return;
    fs.appendFileSync(paths.hookLog(), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch {
    /* never break the host */
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "{}";
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  return raw || "{}";
}
