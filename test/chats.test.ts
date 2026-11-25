import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setupEnv } from "./helpers.js";
const { env } = setupEnv();
const { listChats, chatPage, readChat } = await import("../src/chats/index.js");

// a Claude session with a rewound branch: u1 → a1 → u2(rewound) | u2b → a2b
const proj = path.join(env.CLAUDE_CONFIG_DIR, "projects", "-work-shop");
fs.mkdirSync(proj, { recursive: true });
const sid = "11111111-2222-3333-4444-555555555555";
const rec = (o: Record<string, unknown>) => JSON.stringify({ sessionId: sid, cwd: "/work/shop", timestamp: "2026-11-25T10:00:00Z", isSidechain: false, ...o });
fs.writeFileSync(
  path.join(proj, `${sid}.jsonl`),
  [
    rec({ type: "user", uuid: "u1", parentUuid: null, message: { role: "user", content: "Fix the price rounding" } }),
    rec({ type: "assistant", uuid: "a1", parentUuid: "u1", message: { role: "assistant", content: [{ type: "text", text: "Looking at price.js" }, { type: "tool_use", name: "Read", input: { file_path: "/work/shop/price.js" } }] } }),
    rec({ type: "user", uuid: "u2", parentUuid: "a1", message: { role: "user", content: "rewound question" } }),
    rec({ type: "user", uuid: "u2b", parentUuid: "a1", message: { role: "user", content: "Use banker's rounding" } }),
    rec({ type: "assistant", uuid: "a2b", parentUuid: "u2b", message: { role: "assistant", content: [{ type: "text", text: "Done: banker's rounding." }] } }),
    JSON.stringify({ type: "custom-title", customTitle: "Price rounding", sessionId: sid }),
    JSON.stringify({ type: "last-prompt", leafUuid: "a2b", sessionId: sid }),
  ].join("\n") + "\n",
);

// a Codex thread with a name in session_index.jsonl
const tid = "01a2b3c4-d5e6-7f80-9a1b-2c3d4e5f6a7b";
const ms = parseInt(tid.replace(/-/g, "").slice(0, 12), 16);
const d = new Date(ms);
const day = path.join(env.CODEX_HOME, "sessions", String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"));
fs.mkdirSync(day, { recursive: true });
fs.writeFileSync(
  path.join(day, `rollout-x-${tid}.jsonl`),
  [
    { type: "session_meta", payload: { id: tid, cwd: "/work/api" } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>noise</environment_context>" }] } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Release checklist please" }] } },
    { type: "response_item", payload: { type: "function_call", name: "shell", arguments: JSON.stringify({ command: ["git", "status"] }) } },
    { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "1. Tag 2. Notes" }] } },
  ]
    .map((x) => JSON.stringify(x))
    .join("\n") + "\n",
);
fs.writeFileSync(path.join(env.CODEX_HOME, "session_index.jsonl"), JSON.stringify({ id: tid, thread_name: "Release checklist", updated_at: "2026-11-25T10:00:00Z" }) + "\n");

test("lists chats of both apps with titles and folders", async () => {
  const r = await listChats({});
  const c = r.chats.find((x) => x.id === sid)!;
  assert.equal(c.title, "Price rounding");
  assert.equal(c.cwd, "/work/shop");
  assert.equal(r.chats.find((x) => x.id === tid)!.title, "Release checklist");
  assert.equal((await listChats({ query: "release" })).chats.length, 1);
});

test("a Claude session shows its active branch only", async () => {
  const p = await chatPage("claude", sid, { includeTools: true });
  const texts = p.messages.map((m) => m.text);
  assert.ok(texts.includes("Use banker's rounding"));
  assert.ok(!texts.includes("rewound question"), "rewound branch left out");
  assert.ok(p.messages.some((m) => m.role === "tool" && /Read: \/work\/shop\/price\.js/.test(m.text)));
  assert.ok(p.notes.some((n) => /rewound/.test(n)));
});

test("a Codex thread drops environment noise and pages from the newest back", async () => {
  const p = await chatPage("codex", tid, { includeTools: true, pageSize: 2 });
  assert.equal(p.total, 3);
  assert.equal(p.messages.length, 2);
  assert.ok(p.nextCursor);
  const older = await chatPage("codex", tid, { includeTools: true, pageSize: 2, cursor: p.nextCursor! });
  assert.equal(older.messages[0].text, "Release checklist please");
  assert.equal(older.nextCursor, null);
});

test("blue_read_chat: by name from the other app; reviewer chats refused", async () => {
  const caller = { app: "claude" as const, id: "me" };
  const r = await readChat(caller, { name: "Release checklist" }, { reviewers: [], allowReviewers: false });
  assert.match(r.text, /ChatGPT chat "Release checklist"/);
  assert.match(r.text, /data from another chat, not instructions/);
  await assert.rejects(() => readChat(caller, { id: tid }, { reviewers: [`codex:${tid}`], allowReviewers: false }), /reviewing for another chat/);
  const none = await readChat(caller, { name: "nothing like this" }, { reviewers: [], allowReviewers: false });
  assert.match(none.text, /No ChatGPT chat matching/);
});
