// Every file location BlueAIBridge uses. One root (~/.blueaibridge, or
// BLUE_AI_BRIDGE_HOME) keeps state, config, the installed runtime and backups
// together, so uninstalling is one folder.

import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export const HOME = () => process.env.BLUE_AI_BRIDGE_USER_HOME || os.homedir();
export const ROOT = () => process.env.BLUE_AI_BRIDGE_HOME || path.join(HOME(), ".blueaibridge");

export const paths = {
  root: () => ROOT(),
  data: () => path.join(ROOT(), "data"),
  db: () => path.join(ROOT(), "data", "bridge.db"),
  token: () => path.join(ROOT(), "data", "token"),
  pid: () => path.join(ROOT(), "data", "broker.pid"),
  port: () => path.join(ROOT(), "data", "broker.port"),
  brokerLog: () => path.join(ROOT(), "logs", "broker.log"),
  hookLog: () => path.join(ROOT(), "logs", "hooks.jsonl"),
  logs: () => path.join(ROOT(), "logs"),
  view: () => path.join(ROOT(), "data", "view.json"),
  outbox: () => path.join(ROOT(), "data", "outbox"),
  inbox: () => path.join(ROOT(), "data", "inbox"),
  listeners: () => path.join(ROOT(), "data", "listeners"),
  turns: () => path.join(ROOT(), "data", "turns"),
  config: () => path.join(ROOT(), "config.json"),
  rules: () => path.join(ROOT(), "rules.md"),
  runtime: () => path.join(ROOT(), "runtime"),
  backups: () => path.join(ROOT(), "backups"),
  claudeDir: () => process.env.CLAUDE_CONFIG_DIR || path.join(HOME(), ".claude"),
  claudeJson: () => path.join(HOME(), ".claude.json"),
  codexHome: () => process.env.CODEX_HOME || path.join(HOME(), ".codex"),
  launchAgent: () => path.join(HOME(), "Library", "LaunchAgents", "com.blueaibridge.broker.plist"),
  systemdUnit: () => path.join(process.env.XDG_CONFIG_HOME || path.join(HOME(), ".config"), "systemd", "user", "blueaibridge.service"),
  /** marker the installer writes when it registers the Windows logon task */
  windowsTask: () => path.join(ROOT(), "service-windows-task"),
  macApp: () => path.join(HOME(), "Applications", "BlueAIBridge.app"),
};

export function ensureDirs() {
  for (const d of [paths.data(), paths.outbox(), paths.inbox(), paths.listeners(), paths.turns(), paths.logs()]) {
    fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  }
}

/** Write a file atomically (temp file + rename), so readers never see half a file. */
export function writeAtomic(file: string, data: string, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, data, { mode });
  fs.renameSync(tmp, file);
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** File-name-safe form of an endpoint key. */
export const fileKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, "_");
