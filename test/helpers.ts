// Every test process gets its own throwaway home: state, Claude and Codex
// config folders all live under a temp dir, and both agent CLIs are faked.
import "../src/shared/quiet.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function setupEnv(extra: Record<string, string> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "blueai-test-"));
  const env: Record<string, string> = {
    BLUE_AI_BRIDGE_HOME: path.join(root, "bab"),
    BLUE_AI_BRIDGE_USER_HOME: path.join(root, "home"),
    CODEX_HOME: path.join(root, "home", ".codex"),
    CLAUDE_CONFIG_DIR: path.join(root, "home", ".claude"),
    BLUE_AI_BRIDGE_FAKE_AGENTS: "1",
    BLUE_AI_BRIDGE_FAKE_CODEX: "1",
    BLUE_AI_BRIDGE_FAKE_APPS: "none",
    BLUE_AI_BRIDGE_FAKE_OPEN: "1",
    BLUE_AI_BRIDGE_FAKE_CHATGPT_RUNNING: "1",
    BLUE_AI_BRIDGE_NO_AUTOSTART: "1",
    BLUE_AI_BRIDGE_NO_LAUNCHCTL: "1",
    BLUE_AI_BRIDGE_NO_CLAUDE_CLI: "1",
    BLUE_AI_BRIDGE_CODEX_BIN: "/usr/bin/true",
    BLUE_AI_BRIDGE_CLAUDE_BIN: "/usr/bin/true",
    ...extra,
  };
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  delete process.env.BLUE_AI_BRIDGE_CHILD;
  delete process.env.BLUE_AI_BRIDGE_PORT;
  fs.mkdirSync(env.BLUE_AI_BRIDGE_USER_HOME, { recursive: true });
  return { root, env };
}

export function makeRepo(root: string, name = "repo") {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
  g("init", "-q");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "T");
  g("config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(dir, "a.js"), "let a = 1;\n");
  g("add", ".");
  g("commit", "-qm", "init");
  return { dir, git: g };
}

export function fakeAgent(cfg: { answer?: string; fail?: string }) {
  const dir = path.join(process.env.BLUE_AI_BRIDGE_HOME!, "data");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "fake-agent.json"), JSON.stringify(cfg));
}

export function fakeCalls(): { app: string; prompt: string; sessionId?: string | null }[] {
  try {
    return fs
      .readFileSync(path.join(process.env.BLUE_AI_BRIDGE_HOME!, "data", "fake-agent-calls.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
