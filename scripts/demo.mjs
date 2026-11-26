// Seed a throwaway broker with realistic traffic (fake agents) for UI work and screenshots.
//   node scripts/demo.mjs [port]
// Uses its own state folder; never touches ~/.blueaibridge or the apps.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const port = Number(process.argv[2] ?? 7650);
const home = fs.mkdtempSync(path.join(os.tmpdir(), "blueai-demo-"));
Object.assign(process.env, {
  BLUE_AI_BRIDGE_HOME: home,
  BLUE_AI_BRIDGE_PORT: String(port),
  BLUE_AI_BRIDGE_FAKE_AGENTS: "1",
  BLUE_AI_BRIDGE_FAKE_CODEX: "1",
  BLUE_AI_BRIDGE_FAKE_APPS: "none",
  BLUE_AI_BRIDGE_FAKE_OPEN: "1",
  BLUE_AI_BRIDGE_CODEX_BIN: "/usr/bin/true",
});
await import("../dist/src/shared/quiet.js");
const { startBroker } = await import("../dist/src/broker/http.js");
const h = await startBroker({ port });
const repo = path.join(home, "shop-api");
fs.mkdirSync(repo, { recursive: true });
const g = (...a) => execFileSync("git", a, { cwd: repo, stdio: "ignore" });
g("init", "-q");
g("config", "user.email", "demo@example.com");
g("config", "user.name", "Demo");
fs.writeFileSync(path.join(repo, "price.js"), "export function avg(xs) {\n  return xs.reduce((a, b) => a + b) / xs.length;\n}\n");
g("add", ".");
g("commit", "-qm", "init");
fs.writeFileSync(path.join(repo, "price.js"), "export function averagePriceCents(xs) {\n  if (!xs.length) return 0;\n  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);\n}\n");
fs.writeFileSync(path.join(repo, "price.test.js"), "import { averagePriceCents } from './price.js';\n");

const claude = { app: "claude", id: "7f3c2a10-5b1e-4c55-9d1a-2f0c9a7e11aa", cwd: repo, surface: "desktop", hostId: "local_demo" };
const codex = { app: "codex", id: "01a2b3c4-d5e6-7f80-9a1b-2c3d4e5f6a7b", cwd: repo, surface: "desktop" };
const fake = (o) => fs.writeFileSync(path.join(home, "data", "fake-agent.json"), JSON.stringify(o));
const b = h.bridge;

fake({ answer: "[CHANGES REQUESTED]\n\nThe empty-list case still divides by zero in the old helper, and rounding happens before the sum.\n\nMust fix:\n- price.js:3 — handle `[]` before `reduce` (it throws without an initial value).\n- price.js:3 — round once, after dividing.\n\nNits (optional, don't block approval):\n- Name the function `averagePriceCents`." });
const r1 = await b.review(claude, { request: "Goal: average price for the cart page.\nStep: replaced avg() with averagePriceCents().\nPlease check edge cases and naming.", paths: [repo] });
const link1 = r1.data.linkId;
fake({ answer: "[APPROVED]\n\nBoth must-fix items are handled: the empty list returns 0 and rounding happens once at the end.\n\nNits (optional, don't block approval):\n- Add a test for negative prices." });
await b.review(claude, { request: "Fixed both items: early return for [] and a single Math.round after dividing. Renamed as suggested.", round_of: link1 });
fake({ answer: "Use a composite index on (user_id, created_at DESC); the planner can then serve the feed query with an index-only scan. Keep the old index until the migration is verified." });
await b.ask(claude, { question: "Which Postgres index fits a per-user feed ordered by newest first?", to: "chatgpt" });
fake({ answer: "[APPROVED]\n\nThe plan is sound: migrate in two steps and keep the dual-write until the backfill finishes." });
await b.review(codex, { request: "Plan: move sessions from Redis to Postgres in two steps (dual-write, then backfill and switch reads).", kind: "plan", paths: [] });
await b.auto(claude, { on: true, every_turn: false, reviewer: "join" });
const r4 = await b.review(claude, { request: "Auth middleware refactor: token expiry check moved into verifyToken().", reviewer: "join", paths: [repo] });
b.notice(claude, "BlueAIBridge: ChatGPT's usage limit is at 82% of the current window.", null, false);
fake({ fail: "Claude failed: overloaded (529)" });
try { await b.ask(codex, { question: "Is this Swift concurrency code free of data races?", to: "claude" }); } catch {}
fake({});
for (let i = 0; i < 6; i++) await b.ask(i % 2 ? codex : claude, { question: `Quick check #${i + 1}: is this regex anchored correctly? ^[a-z0-9_-]{3,16}$`, to: i % 2 ? "claude" : "chatgpt" });
// more traffic, spread over the last 20 hours so the charts look like a real day
const questions = ["Is this migration safe to run twice?", "Which cache key avoids stale prices?", "Does this retry loop need jitter?", "Is the token refresh race-free?", "Should this be a partial index?", "Is this error message clear enough?"];
for (let i = 0; i < 36; i++) {
  fake({ answer: `Short answer #${i + 1}: yes, with one caveat about ordering.` });
  const from = i % 3 === 0 ? codex : claude;
  await b.ask(from, { question: questions[i % questions.length], to: from === codex ? "claude" : "chatgpt" });
}
fake({ answer: "[CHANGES REQUESTED]\n\nThe handler swallows the error.\n\nMust fix:\n- api/orders.ts:42 — rethrow after logging." });
await b.review(codex, { request: "Order API: added retry around the payment call.", paths: [repo] });
fake({});
{
  const db = b.store.db;
  const now = Date.now();
  const msgs = db.prepare("SELECT id, created_at, delivered_at, answered_at FROM messages ORDER BY created_at").all();
  msgs.forEach((m, i) => {
    const shift = Math.round(((msgs.length - i) / msgs.length) * 20 * 3600_000 * (0.7 + Math.random() * 0.3));
    const lat = 4000 + Math.round(Math.random() * 90_000);
    db.prepare("UPDATE messages SET created_at = ?, delivered_at = CASE WHEN delivered_at IS NULL THEN NULL ELSE ? END, answered_at = CASE WHEN answered_at IS NULL THEN NULL ELSE ? END WHERE id = ?")
      .run(now - shift, now - shift + lat, now - shift + lat + 20_000 + Math.round(Math.random() * 200_000), m.id);
  });
  for (const l of db.prepare("SELECT id FROM links").all()) {
    const r = db.prepare("SELECT MIN(created_at) a, MAX(created_at) z FROM messages WHERE link_id = ?").get(l.id);
    if (r.a) db.prepare("UPDATE links SET created_at = ?, updated_at = ? WHERE id = ?").run(r.a, r.z, l.id);
  }
  db.prepare("UPDATE events SET ts = (SELECT created_at FROM messages WHERE messages.id = events.message_id) WHERE message_id IS NOT NULL").run();
}
console.log(`demo broker: http://127.0.0.1:${h.port}/auth?token=${h.token}`);
console.log(`join code waiting: ${r4.data.joinCode}`);
console.log(`state: ${home}`);
