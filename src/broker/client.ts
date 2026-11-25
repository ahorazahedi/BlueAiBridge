// How the MCP servers, the CLI and the menu-bar app reach the broker: find it
// (port file), start it when it isn't running (detached), and call it.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { paths, ensureDirs } from "../shared/paths.js";
import { loadConfig } from "../shared/config.js";
import { childEnv } from "../shared/platform.js";
import { sleep } from "../shared/util.js";
import { brokerToken } from "./http.js";

const CLI = path.resolve(import.meta.dirname, "../cli.js");

export function brokerPort(): number {
  try {
    const n = Number(fs.readFileSync(paths.port(), "utf8").trim());
    if (n > 0) return n;
  } catch {
    /* default */
  }
  return loadConfig().port;
}

export async function health(port = brokerPort(), timeoutMs = 1500): Promise<{ ok: boolean; version?: string; pid?: number; port?: number } | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok ? ((await r.json()) as { ok: boolean }) : null;
  } catch {
    return null;
  }
}

/** Start the broker in the background if it isn't running; resolve once it answers. */
export async function ensureBroker(): Promise<number> {
  const port = brokerPort();
  if (await health(port)) return port;
  ensureDirs();
  const log = fs.openSync(paths.brokerLog(), "a");
  const child = spawn(process.execPath, ["--no-warnings", CLI, "broker"], {
    detached: true,
    stdio: ["ignore", log, log],
    env: childEnv({ BLUE_AI_BRIDGE_CHILD: "" }),
    cwd: paths.root(),
  });
  child.unref();
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    const p = brokerPort();
    if (await health(p, 500)) return p;
  }
  throw new Error(`the BlueAIBridge broker didn't start (see ${paths.brokerLog()})`);
}

export async function call<T = unknown>(pathname: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const port = await ensureBroker();
  const r = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { Authorization: `Bearer ${brokerToken()}`, "Content-Type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: init.timeoutMs ? AbortSignal.timeout(init.timeoutMs) : undefined,
  });
  const text = await r.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text };
  }
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${r.status}`);
  return data as T;
}
