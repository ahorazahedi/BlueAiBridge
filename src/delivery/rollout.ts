// Follow a queued prompt in a Codex thread's rollout file
// (~/.codex/sessions/YYYY/MM/DD/rollout-…-<threadId>.jsonl): did the turn for
// our message start, finish, or fail, and what was its final answer?

import fs from "node:fs";
import path from "node:path";
import { paths } from "../shared/paths.js";

/** Find a thread's rollout. UUIDv7 ids carry their creation time, which names the day folder. */
export function rolloutOf(threadId: string): string | null {
  const root = path.join(paths.codexHome(), "sessions");
  const hex = threadId.replace(/-/g, "");
  const days: string[] = [];
  if (hex[12] === "7") {
    const ms = parseInt(hex.slice(0, 12), 16);
    const pad = (n: number) => String(n).padStart(2, "0");
    for (const shift of [0, -86_400_000, 86_400_000]) {
      const d = new Date(ms + shift);
      days.push(path.join(root, String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate())));
    }
  }
  for (const dir of days) {
    const hit = findIn(dir, threadId);
    if (hit) return hit;
  }
  // older ids: search the most recent days
  try {
    const years = fs.readdirSync(root).sort().reverse();
    for (const y of years) {
      for (const m of fs.readdirSync(path.join(root, y)).sort().reverse()) {
        for (const d of fs.readdirSync(path.join(root, y, m)).sort().reverse()) {
          const hit = findIn(path.join(root, y, m, d), threadId);
          if (hit) return hit;
        }
      }
    }
  } catch {
    /* no sessions folder */
  }
  return null;
}

function findIn(dir: string, threadId: string): string | null {
  try {
    const n = fs.readdirSync(dir).find((f) => f.startsWith("rollout-") && f.endsWith(`-${threadId}.jsonl`));
    return n ? path.join(dir, n) : null;
  } catch {
    return null;
  }
}

export type TurnState =
  | { state: "not_started" }
  | { state: "running"; turnId: string | null }
  | { state: "complete"; turnId: string | null; lastMessage: string | null }
  | { state: "failed"; turnId: string | null; error: string };

const TAIL = 4 * 1024 * 1024;

/**
 * Where the turn that ran our message stands. Our message is recognised by
 * `marker` (the bridge's footer line) inside a user message.
 */
export function turnFor(file: string, marker: string): TurnState {
  let text: string;
  try {
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const start = Math.max(0, size - TAIL);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      text = buf.toString("utf8");
      if (start > 0) text = text.slice(text.indexOf("\n") + 1);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { state: "not_started" };
  }
  let found = false;
  let turnId: string | null = null;
  let currentTurn: string | null = null;
  let lastMessage: string | null = null;
  for (const line of text.split("\n")) {
    if (!line) continue;
    let r: { type?: string; payload?: Record<string, unknown> };
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    const p = r.payload ?? {};
    if (r.type === "event_msg" && p.type === "task_started") currentTurn = (p.turn_id as string) ?? null;
    if (r.type === "turn_context") currentTurn = (p.turn_id as string) ?? currentTurn;
    if (!found) {
      if (r.type === "response_item" && p.type === "message" && p.role === "user" && JSON.stringify(p.content ?? "").includes(jsonInner(marker))) {
        found = true;
        turnId = currentTurn;
      }
      continue;
    }
    if (r.type === "response_item" && p.type === "message" && p.role === "assistant") {
      const c = p.content as { type: string; text?: string }[] | undefined;
      const t = c?.filter((x) => x.type === "output_text").map((x) => x.text ?? "").join("\n");
      if (t) lastMessage = t;
    }
    if (r.type === "event_msg") {
      if (p.type === "task_complete" && (!turnId || p.turn_id === turnId)) {
        return { state: "complete", turnId, lastMessage: (p.last_agent_message as string) ?? lastMessage };
      }
      if ((p.type === "turn_aborted" || p.type === "error" || p.type === "stream_error") && (!turnId || !p.turn_id || p.turn_id === turnId)) {
        const msg = String(p.message ?? p.reason ?? p.type);
        if (p.type !== "stream_error") return { state: "failed", turnId, error: msg };
      }
    }
  }
  return found ? { state: "running", turnId } : { state: "not_started" };
}

/** A string as it appears inside a JSON-encoded string (escapes quotes, etc.). */
const jsonInner = (s: string) => JSON.stringify(s).slice(1, -1);

/** The originator recorded in a thread's first line: codex_work_desktop, codex_exec, codex_cli_rs… */
export function originatorOf(threadId: string): string | null {
  const f = rolloutOf(threadId);
  if (!f) return null;
  try {
    const fd = fs.openSync(f, "r");
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const first = buf.subarray(0, n).toString("utf8").split("\n")[0];
    return (JSON.parse(first).payload?.originator as string) ?? null;
  } catch {
    return null;
  }
}
