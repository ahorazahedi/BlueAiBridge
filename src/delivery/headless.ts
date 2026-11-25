// Headless runs: the other app's own CLI, logged in with the user's own
// subscription. `codex exec` / `claude -p` start or resume a session and
// return its final answer. The child runs without BlueAIBridge loaded, so it
// can never call back (no ping-pong).

import fs from "node:fs";
import path from "node:path";
import { childEnv, locateClaude, locateCodex } from "../shared/platform.js";
import { paths } from "../shared/paths.js";
import { codexHasBridge } from "./appserver.js";
import { lastLines, run } from "../shared/util.js";
import type { App } from "../shared/types.js";

export interface HeadlessResult {
  answer: string;
  sessionId: string;
  durationMs: number;
}

export interface HeadlessOptions {
  prompt: string;
  cwd: string;
  sessionId?: string | null;
  model?: string;
  effort?: string;
  writable?: boolean;
  timeoutMs: number;
}

export async function runCodex(o: HeadlessOptions): Promise<HeadlessResult> {
  const fake = fakeRun("codex", o);
  if (fake) return fake;
  const bin = locateCodex();
  if (!bin) throw new Error("codex CLI not found: install ChatGPT Desktop or the Codex CLI (or set BLUE_AI_BRIDGE_CODEX_BIN)");
  const opts = ["--json", "--skip-git-repo-check", "-c", `sandbox_mode="${o.writable ? "workspace-write" : "read-only"}"`];
  if (codexHasBridge()) opts.push("-c", "mcp_servers.blue_ai_bridge.enabled=false");
  if (o.model) opts.push("-m", o.model);
  if (o.effort) opts.push("-c", `model_reasoning_effort="${o.effort}"`);
  const args = o.sessionId ? ["exec", "resume", ...opts, o.sessionId, "-"] : ["exec", ...opts, "-"];
  const t0 = Date.now();
  const r = await run(bin.path, args, { cwd: o.cwd, env: childEnv(), input: o.prompt, timeoutMs: o.timeoutMs });
  if (r.timedOut) throw new Error(`ChatGPT gave no answer within ${Math.round(o.timeoutMs / 1000)} s`);
  let threadId = o.sessionId ?? null;
  let answer: string | null = null;
  const errors: string[] = [];
  for (const line of r.stdout.split("\n")) {
    let ev: { type?: string; thread_id?: string; item?: { type?: string; text?: string }; message?: string; error?: { message?: string } };
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type === "thread.started") threadId = ev.thread_id ?? threadId;
    if (ev.type === "item.completed" && ev.item?.type === "agent_message" && ev.item.text) answer = ev.item.text;
    if (ev.type === "error" || ev.type === "turn.failed") errors.push(ev.message ?? ev.error?.message ?? JSON.stringify(ev));
  }
  if (!answer || !threadId) throw new Error(`ChatGPT gave no answer (exit ${r.code}). ${errors.join(" ")} ${lastLines(r.stderr)}`.trim());
  return { answer, sessionId: threadId, durationMs: Date.now() - t0 };
}

const READ_ONLY_TOOLS = ["Read", "Grep", "Glob", "LS", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git status:*)", "Bash(git show:*)", "Bash(ls:*)"];

export async function runClaude(o: HeadlessOptions): Promise<HeadlessResult> {
  const fake = fakeRun("claude", o);
  if (fake) return fake;
  const bin = locateClaude();
  if (!bin) throw new Error("claude CLI not found: install Claude Code (or set BLUE_AI_BRIDGE_CLAUDE_BIN)");
  // --strict-mcp-config without --mcp-config: no MCP servers, so no bridge in the child
  const args = ["-p", "--output-format", "json", "--strict-mcp-config"];
  if (o.writable) args.push("--permission-mode", "acceptEdits");
  else args.push("--allowedTools", ...READ_ONLY_TOOLS, "--disallowedTools", "Edit", "Write", "NotebookEdit");
  if (o.model) args.push("--model", o.model);
  if (o.sessionId) args.push("--resume", o.sessionId);
  const t0 = Date.now();
  const r = await run(bin.path, args, { cwd: o.cwd, env: childEnv(), input: o.prompt, timeoutMs: o.timeoutMs });
  if (r.timedOut) throw new Error(`Claude gave no answer within ${Math.round(o.timeoutMs / 1000)} s`);
  let res: { result?: string; session_id?: string; is_error?: boolean; subtype?: string };
  try {
    res = JSON.parse(r.stdout.trim().split("\n").filter(Boolean).at(-1) ?? "");
  } catch {
    throw new Error(`Claude gave no answer (exit ${r.code}). ${lastLines(r.stderr)}`.trim());
  }
  if (res.is_error || typeof res.result !== "string" || !res.session_id) throw new Error(`Claude failed: ${res.result ?? res.subtype ?? "unknown error"}`);
  return { answer: res.result, sessionId: res.session_id, durationMs: Date.now() - t0 };
}

export const runHeadless = (app: App, o: HeadlessOptions) => (app === "codex" ? runCodex(o) : runClaude(o));

/**
 * Tests replace both CLIs with BLUE_AI_BRIDGE_FAKE_AGENTS=1: the answer comes
 * from <data>/fake-agent.json ({ "answer": "...", "fail": "..." }) or a default.
 */
function fakeRun(app: App, o: HeadlessOptions): HeadlessResult | null {
  if (!process.env.BLUE_AI_BRIDGE_FAKE_AGENTS) return null;
  let cfg: { answer?: string; fail?: string } = {};
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(paths.data(), "fake-agent.json"), "utf8"));
  } catch {
    /* defaults */
  }
  fs.appendFileSync(path.join(paths.data(), "fake-agent-calls.jsonl"), JSON.stringify({ app, ...o, timeoutMs: undefined }) + "\n");
  if (cfg.fail) throw new Error(cfg.fail);
  const answer = cfg.answer ?? (/review request/.test(o.prompt) ? "[APPROVED]\n\nLooks good to me.\n\nNits (optional, don't block approval):\n- name things well" : `${app} says: ${o.prompt.slice(-80)}`);
  return { answer, sessionId: o.sessionId ?? `fake-${app}-${Math.random().toString(36).slice(2, 10)}`, durationMs: 5 };
}
