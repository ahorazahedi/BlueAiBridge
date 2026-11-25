import { test } from "node:test";
import assert from "node:assert/strict";
import { setupEnv } from "./helpers.js";
setupEnv();
const { validateDecision, parseDecisionText } = await import("../src/core/decision.js");
const { isSecretPath } = await import("../src/shared/secrets.js");
const { validateConfig, saveConfig, loadConfig, saveRules, rulesBlock, RULES_MAX } = await import("../src/shared/config.js");
const { pickModel, summarizeLimits, ModelChoiceError } = await import("../src/delivery/appserver.js");
const T = await import("../src/core/texts.js");

test("validateDecision enforces an unambiguous verdict", () => {
  assert.deepEqual(validateDecision({ decision: "approved", note: "ok", nits: ["x"] }), { decision: "approved", note: "ok", blocking: [], nits: ["x"] });
  assert.throws(() => validateDecision({ decision: "approved", note: "ok", blocking: ["bug"] }), /can't have must-fix/);
  assert.throws(() => validateDecision({ decision: "changes_requested", note: "no" }), /at least one must-fix/);
  assert.throws(() => validateDecision({ decision: "maybe", note: "x" }), /must be/);
  assert.throws(() => validateDecision({ decision: "approved", note: " " }), /note is required/);
  assert.equal(validateDecision({ decision: "Changes Requested", note: "n", blocking: "one item" }).blocking[0], "one item");
});

test("parseDecisionText reads prose verdicts and repairs inconsistent ones", () => {
  const d = parseDecisionText("[CHANGES REQUESTED]\n\nBreaks on empty.\n\nMust fix:\n- empty list throws\n  (price.js:3)\n- rounding\n\nNits (optional, don't block approval):\n- naming")!;
  assert.equal(d.decision, "changes_requested");
  assert.equal(d.note, "Breaks on empty.");
  assert.deepEqual(d.blocking, ["empty list throws (price.js:3)", "rounding"]);
  assert.deepEqual(d.nits, ["naming"]);
  assert.equal(parseDecisionText("Looks fine to me"), null);
  const a = parseDecisionText("**[APPROVED]** all good\n\nMust fix:\n- none")!;
  assert.equal(a.decision, "approved");
  assert.deepEqual(a.blocking, []);
  const repaired = parseDecisionText("[APPROVED]\nok\nMust fix:\n- actually a bug")!;
  assert.equal(repaired.decision, "changes_requested");
  const noItems = parseDecisionText("[CHANGES REQUESTED] please redo the parser")!;
  assert.equal(noItems.blocking.length, 1);
});

test("secret paths are recognised by name and folder", () => {
  for (const p of [".env", "app/.env.local", "certs/server.pem", "id_rsa", "config/secrets.yml", "my_credentials.json", "secrets/db.txt", ".ssh/config", ".aws/credentials", ".npmrc", "x/auth.json"]) assert.ok(isSecretPath(p), p);
  for (const p of ["src/index.ts", "README.md", "env.ts", "docs/keyboard.md"]) assert.ok(!isSecretPath(p), p);
});

test("config validation and persistence", () => {
  assert.deepEqual(validateConfig({ delivery: "headless", maxRounds: 5 }).errors, []);
  assert.match(validateConfig({ delivery: "fax" }).errors.join(), /delivery must be one of/);
  assert.match(validateConfig({ port: 80 }).errors.join(), /port/);
  assert.match(validateConfig({ nope: 1 }).errors.join(), /unknown setting/);
  saveConfig({ autoReviews: "every-turn", maxRounds: 7 });
  assert.equal(loadConfig().autoReviews, "every-turn");
  assert.equal(loadConfig().maxRounds, 7);
  assert.throws(() => saveConfig({ maxRounds: 0 }));
});

test("rules come only from the user's file and are capped", () => {
  assert.equal(rulesBlock(), "");
  saveRules("Always answer in Turkish.");
  assert.match(rulesBlock(), /Always answer in Turkish/);
  assert.throws(() => saveRules("x".repeat(RULES_MAX + 1)));
});

test("ChatGPT model choice is checked against the app's list", () => {
  const models = [
    { id: "gpt-6-astra", model: "gpt-6-astra", displayName: "GPT-6-Astra", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }] },
    { id: "hidden", model: "hidden-one", hidden: true },
  ];
  assert.equal(pickModel(models, "GPT-6-Astra", "high"), "gpt-6-astra");
  assert.equal(pickModel(models, "hidden-one"), "hidden-one");
  assert.throws(() => pickModel(models, "gpt-9"), (e: Error) => e instanceof ModelChoiceError && /gpt-6-astra/.test(e.message) && !/hidden-one/.test(e.message));
  assert.throws(() => pickModel(models, "gpt-6-astra", "xhigh"), /no effort "xhigh"/);
  assert.equal(pickModel(null, "anything"), "anything");
});

test("usage limits summary", () => {
  const s = summarizeLimits({ ordinaryUsageAllowed: false, rateLimits: { primary: { usedPercent: 100, resetsAt: 1000 }, credits: { hasCredits: false } } });
  assert.equal(s.blocked, true);
  assert.equal(s.resetsAt, 1_000_000);
  assert.equal(summarizeLimits({ ordinaryUsageAllowed: false, rateLimits: { credits: { hasCredits: true } } }).blocked, false);
});

test("prompts carry the reviewer role, answer format and footer", () => {
  const p = T.reviewPrompt({ id: "M3", body: "please review", round: 2, from: { app: "claude", id: "x" } }, { kind: "code", previous: { decision: "changes_requested", note: "n", blocking: ["b"], nits: [] }, readOnly: true, linkId: "L1" });
  assert.match(p, /^CLAUDE: \[BLUE-AI-BRIDGE review request M3/);
  assert.match(p, /follow-up round/);
  assert.match(p, /previous round/);
  assert.match(p, /blue_advise\(request_id: "M3"/);
  assert.ok(p.endsWith(T.FOOTER("M3")));
  const a = T.answerPrompt({ id: "M4", from: { app: "codex", id: "y" }, decision: { decision: "changes_requested", note: "n", blocking: ["b"], nits: [] }, body: "", round: 1 }, { id: "L1", reviewKind: "code", ownInitiative: false, kind: "review" }, 20);
  assert.match(a, /round_of: "L1"/);
  const plan = T.answerPrompt({ id: "M5", from: { app: "codex", id: "y" }, decision: { decision: "approved", note: "ok", blocking: [], nits: [] }, body: "", round: 1 }, { id: "L2", reviewKind: "plan", ownInitiative: false, kind: "review" }, 20);
  assert.match(plan, /not the user's approval/);
});
