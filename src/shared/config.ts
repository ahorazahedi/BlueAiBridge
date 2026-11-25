// User settings (config.json) and standing rules (rules.md).

import fs from "node:fs";
import { paths, readJson, writeAtomic } from "./paths.js";

export interface Config {
  /** Broker HTTP port on 127.0.0.1. */
  port: number;
  /** How messages reach the other chat by default. auto = visible when the app can take it, else headless. */
  delivery: "auto" | "visible" | "headless";
  /** Auto mode default: review at key moments, or every turn. */
  autoReviews: "key-moments" | "every-turn";
  /** When the other app is closed: ask the user first, or always open it. */
  openClosedApps: "ask" | "always";
  /** Allow reading chats that currently act as reviewers. */
  readChatsInReviewers: "deny" | "allow";
  /** Fix-loop emergency stop. */
  maxRounds: number;
  /** Default ChatGPT model / effort for new reviewer threads (empty = app default). */
  chatgptModel: string;
  chatgptEffort: string;
  /** Default Claude model for headless reviewers (empty = Claude default). */
  claudeModel: string;
  /** Headless run time limit, seconds. */
  headlessTimeoutSec: number;
  /** How long to keep message history, days. */
  retentionDays: number;
  /** Paste diffs into requests by default (for reviewers that can't read the paths). */
  includeDiff: boolean;
}

export const DEFAULT_CONFIG: Config = {
  port: 7600,
  delivery: "auto",
  autoReviews: "key-moments",
  openClosedApps: "ask",
  readChatsInReviewers: "deny",
  maxRounds: 20,
  chatgptModel: "",
  chatgptEffort: "",
  claudeModel: "",
  headlessTimeoutSec: 900,
  retentionDays: 30,
  includeDiff: false,
};

const ENUMS: Partial<Record<keyof Config, readonly string[]>> = {
  delivery: ["auto", "visible", "headless"],
  autoReviews: ["key-moments", "every-turn"],
  openClosedApps: ["ask", "always"],
  readChatsInReviewers: ["deny", "allow"],
};

/** Validate a partial config; returns the clean values and a list of problems. */
export function validateConfig(input: Record<string, unknown>): { value: Partial<Config>; errors: string[] } {
  const value: Partial<Config> = {};
  const errors: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (!(k in DEFAULT_CONFIG)) {
      errors.push(`unknown setting "${k}"`);
      continue;
    }
    const key = k as keyof Config;
    const def = DEFAULT_CONFIG[key];
    if (typeof def === "number") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) errors.push(`${k} must be a positive number`);
      else if (key === "port" && (n < 1024 || n > 65535)) errors.push("port must be between 1024 and 65535");
      else if (key === "maxRounds" && (n < 1 || n > 100)) errors.push("maxRounds must be between 1 and 100");
      else (value as Record<string, unknown>)[key] = Math.round(n);
    } else if (typeof def === "boolean") {
      if (typeof v !== "boolean") errors.push(`${k} must be true or false`);
      else (value as Record<string, unknown>)[key] = v;
    } else {
      const s = String(v ?? "").trim();
      const allowed = ENUMS[key];
      if (allowed && !allowed.includes(s)) errors.push(`${k} must be one of ${allowed.join(", ")}`);
      else (value as Record<string, unknown>)[key] = s;
    }
  }
  return { value, errors };
}

export function loadConfig(): Config {
  const raw = readJson<Record<string, unknown>>(paths.config(), {});
  const { value } = validateConfig(Object.fromEntries(Object.entries(raw).filter(([k]) => k in DEFAULT_CONFIG)));
  const env = process.env.BLUE_AI_BRIDGE_PORT ? { port: Number(process.env.BLUE_AI_BRIDGE_PORT) } : {};
  return { ...DEFAULT_CONFIG, ...value, ...env };
}

export function saveConfig(patch: Record<string, unknown>): Config {
  const { value, errors } = validateConfig(patch);
  if (errors.length) throw new Error(errors.join("; "));
  const current = readJson<Record<string, unknown>>(paths.config(), {});
  const next = { ...current, ...value };
  writeAtomic(paths.config(), JSON.stringify(next, null, 2) + "\n");
  return loadConfig();
}

export const RULES_MAX = 8000;

export function loadRules(): string {
  try {
    return fs.readFileSync(paths.rules(), "utf8").trim().slice(0, RULES_MAX);
  } catch {
    return "";
  }
}

export function saveRules(text: string) {
  if (text.length > RULES_MAX) throw new Error(`rules.md is limited to ${RULES_MAX} characters`);
  writeAtomic(paths.rules(), text.trim() ? text.trim() + "\n" : "");
}

/** The rules block added to prompts and tool results. Only ever from the user's own file. */
export function rulesBlock(): string {
  const rules = loadRules();
  return rules ? `\n\n[BlueAIBridge — the user's standing rules (from their own rules.md; what the user says in this chat comes first)]\n${rules}` : "";
}
