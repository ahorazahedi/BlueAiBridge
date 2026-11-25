// Domain types shared by the broker, the MCP server, the hooks and the dashboard API.

/** Which agent app a chat lives in. */
export type App = "claude" | "codex";

/** Where that chat runs. `headless` chats are created by BlueAIBridge itself (`claude -p` / `codex exec`). */
export type Surface = "desktop" | "cli" | "headless" | "unknown";

/** A chat: a Claude Code session or a Codex / ChatGPT thread. */
export interface Endpoint {
  app: App;
  id: string;
}

export interface ClientInfo extends Endpoint {
  surface: Surface;
  cwd: string | null;
  title: string | null;
  /** Claude Desktop's own session id (opens the session with claude://code/continue). */
  hostId: string | null;
  firstSeen: number;
  lastSeen: number;
  /** Last heartbeat of a Claude listener hook (ms epoch), null when never seen. */
  listenerAt: number | null;
}

export type LinkKind = "review" | "auto" | "ask" | "turn";
export type ReviewKind = "code" | "plan";
export type LinkStatus = "waiting_join" | "open" | "answered" | "closed";
export type Delivery = "visible" | "headless";

export interface Link {
  id: string;
  kind: LinkKind;
  reviewKind: ReviewKind | null;
  status: LinkStatus;
  requester: Endpoint;
  reviewer: Endpoint | null;
  joinCode: string | null;
  delivery: Delivery;
  round: number;
  paths: string[];
  title: string;
  ownInitiative: boolean;
  /** Fingerprints of `paths` when the current round was requested (auto mode approvals). */
  fingerprints: Record<string, string>;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
  closeReason: string | null;
}

export type MessageKind = "request" | "answer" | "message" | "notice" | "ask" | "reply";
export type MessageState =
  | "pending" // stored, not handed over yet
  | "deferred" // waits for a condition (app closed, usage limit, join, reviewer busy)
  | "sending" // a delivery attempt is running
  | "delivered" // handed to the chat (queued in ChatGPT, woke Claude, or returned inline)
  | "answered" // a request whose answer arrived
  | "failed"
  | "cancelled";

export interface Decision {
  decision: "approved" | "changes_requested";
  note: string;
  blocking: string[];
  nits: string[];
}

export interface Message {
  id: string;
  linkId: string | null;
  kind: MessageKind;
  from: Endpoint | null; // null = BlueAIBridge itself
  to: Endpoint | null; // null = reviewer not known yet (join code)
  body: string;
  decision: Decision | null;
  round: number;
  replyTo: string | null;
  state: MessageState;
  channel: Delivery | "inline" | "note" | null;
  attempts: number;
  error: string | null;
  deferredUntil: number | null;
  deferReason: string | null;
  bytes: number;
  createdAt: number;
  deliveredAt: number | null;
  answeredAt: number | null;
  /** Codex clientUserMessageId of the queued prompt (follows that turn). */
  clientId: string | null;
}

export interface AutoState {
  key: string; // "<app>:<id>"
  owner: Endpoint;
  on: boolean;
  everyTurn: boolean;
  reviewer: Endpoint | null;
  reviewerPref: ReviewerPref;
  paths: string[];
  /** path -> fingerprint the reviewer approved */
  approved: Record<string, string>;
  /** fingerprint (combined) the end-of-turn guard already stopped once for */
  guardedFor: string | null;
  promptsSinceReview: number;
  fixRound: number;
  wrapUpOffered: boolean;
  startedAt: number;
}

export interface ReviewerPref {
  type: "chatgpt" | "claude" | "join";
  model?: string;
  effort?: string;
  threadId?: string;
  sessionId?: string;
}

export interface BridgeEvent {
  id: number;
  ts: number;
  type: string;
  linkId: string | null;
  messageId: string | null;
  actor: string | null;
  bytes: number;
  data: Record<string, unknown>;
}

/** What hooks read: a compact, file-based view of the broker state (hooks never use the network). */
export interface HookView {
  version: number;
  writtenAt: number;
  autos: Record<string, AutoState>;
  /** endpoint key -> open review requests addressed to it (for SessionStart reminders) */
  waitingReviews: Record<string, { id: string; linkId: string; from: string; round: number; summary: string }[]>;
  /** endpoint keys acting as reviewers (reading their chats is refused) */
  reviewers: string[];
  /** endpoint key -> link ids with an open request from this endpoint */
  openRequests: Record<string, string[]>;
}

export const keyOf = (e: Endpoint) => `${e.app}:${e.id}`;
export const sameEndpoint = (a: Endpoint | null | undefined, b: Endpoint | null | undefined) =>
  !!a && !!b && a.app === b.app && a.id === b.id;
export const appName = (a: App) => (a === "claude" ? "Claude" : "ChatGPT");
export const otherApp = (a: App): App => (a === "claude" ? "codex" : "claude");
