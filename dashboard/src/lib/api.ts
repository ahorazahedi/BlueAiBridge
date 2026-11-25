import type { AutoState, BridgeEvent, ClientInfo, Endpoint, Link, Message } from "../../../src/shared/types";

export type { AutoState, BridgeEvent, ClientInfo, Endpoint, Link, Message };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const r = await fetch(path, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
    signal: init.signal,
  });
  const text = await r.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!r.ok) throw new ApiError((data as { error?: string })?.error ?? `HTTP ${r.status}`, r.status);
  return data as T;
}

export interface Summary {
  range: string;
  messages: number;
  bytes: number;
  failed: number;
  avgDeliveryMs: number | null;
  avgReviewMs: number | null;
  openLinks: number;
  pending: number;
  autosOn: number;
  clients: number;
  decisions: Record<string, number>;
  byChannel: { channel: string; messages: number; bytes: number }[];
  byDirection: { from: string; to: string; messages: number; bytes: number }[];
  version: string;
  startedAt: number;
  config: Config;
}

export interface SeriesPoint {
  t: number;
  claudeToChatgpt: number;
  chatgptToClaude: number;
  bridge: number;
  bytes: number;
  failed: number;
}

export interface Config {
  port: number;
  delivery: "auto" | "visible" | "headless";
  autoReviews: "key-moments" | "every-turn";
  openClosedApps: "ask" | "always";
  readChatsInReviewers: "deny" | "allow";
  maxRounds: number;
  chatgptModel: string;
  chatgptEffort: string;
  claudeModel: string;
  headlessTimeoutSec: number;
  retentionDays: number;
  includeDiff: boolean;
}

export type LinkRow = Link & { messageCount: number; lastMessage: Message | null };

export interface LinkDetail {
  link: Link;
  messages: Message[];
  events: BridgeEvent[];
  requester: ClientInfo | null;
  reviewer: ClientInfo | null;
}

export interface InstallTarget {
  id: "claude" | "codex" | "service" | "menubar";
  name: string;
  installed: boolean;
  partial: boolean;
  details: Record<string, unknown>;
  clients: { id: string; name: string; detected: boolean; path?: string | null }[];
}
export interface InstallStatus {
  version: string;
  runtime: { installed: boolean; version: string | null; path: string; upToDate: boolean };
  targets: InstallTarget[];
}
export interface InstallResult {
  ok: boolean;
  action: "install" | "uninstall";
  steps: { target: string; ok: boolean; message: string }[];
  backupDir: string | null;
}
export interface Check {
  group: string;
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  fix?: string;
}
export interface ChatSummary {
  app: "claude" | "codex";
  id: string;
  title: string;
  cwd: string | null;
  updatedAt: number;
  size: number;
}
export interface ChatPage {
  app: "claude" | "codex";
  id: string;
  title: string;
  cwd: string | null;
  total: number;
  start: number;
  end: number;
  messages: { role: "user" | "assistant" | "tool" | "system"; text: string; ts: number | null; cut?: boolean }[];
  nextCursor: string | null;
  notes: string[];
}
export interface Limits {
  blocked: boolean;
  resetsAt: number | null;
  primary: { usedPercent: number; resetsAt: number | null } | null;
  secondary: { usedPercent: number; resetsAt: number | null } | null;
  credits: boolean;
}
