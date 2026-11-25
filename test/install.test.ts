import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setupEnv } from "./helpers.js";
const { env } = setupEnv();
const { runInstall, installStatus, runtimeCli } = await import("../src/install/installer.js");

const claudeSettings = path.join(env.CLAUDE_CONFIG_DIR, "settings.json");
const claudeJson = path.join(env.BLUE_AI_BRIDGE_USER_HOME, ".claude.json");
const toml = path.join(env.CODEX_HOME, "config.toml");
const codexHooks = path.join(env.CODEX_HOME, "hooks.json");

// the user's own settings, which must survive install and uninstall
fs.mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
fs.mkdirSync(env.CODEX_HOME, { recursive: true });
const userHook = { type: "command", command: "echo mine" };
fs.writeFileSync(claudeSettings, JSON.stringify({ theme: "dark", permissions: { allow: ["Bash(ls:*)"] }, hooks: { Stop: [{ hooks: [userHook] }] } }, null, 2));
fs.writeFileSync(claudeJson, JSON.stringify({ mcpServers: { other: { type: "stdio", command: "x" } }, numStartups: 3 }));
fs.writeFileSync(toml, 'model = "gpt-6"\n\n[mcp_servers.other]\ncommand = "x"\n');
fs.writeFileSync(codexHooks, JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [userHook] }] } }));

test("install all: runtime, Claude, Codex; idempotent; status reports it", async () => {
  const r = await runInstall("install", "all");
  const failed = r.steps.filter((s) => !s.ok && s.target !== "menubar");
  assert.deepEqual(failed, [], JSON.stringify(r.steps));
  assert.ok(fs.existsSync(runtimeCli()), "runtime copied");
  assert.ok(fs.existsSync(path.join(path.dirname(path.dirname(path.dirname(runtimeCli()))), "dashboard", "index.html")) || fs.existsSync(path.join(env.BLUE_AI_BRIDGE_HOME, "runtime", "current", "dist", "dashboard", "index.html")));

  const s = JSON.parse(fs.readFileSync(claudeSettings, "utf8"));
  assert.equal(s.theme, "dark");
  assert.deepEqual(s.permissions.allow, ["Bash(ls:*)", "mcp__blue-ai-bridge"]);
  const stop = s.hooks.Stop.flatMap((g: { hooks: { command: string; asyncRewake?: boolean }[] }) => g.hooks);
  assert.ok(stop.some((h: { command: string }) => h.command === "echo mine"), "user hook kept");
  assert.ok(stop.some((h: { command: string; asyncRewake?: boolean }) => /--event listen/.test(h.command) && h.asyncRewake), "listener installed");
  assert.equal(s.hooks.Notification[0].matcher, "permission_prompt");
  const cj = JSON.parse(fs.readFileSync(claudeJson, "utf8"));
  assert.ok(cj.mcpServers.other && cj.mcpServers["blue-ai-bridge"]);
  assert.equal(cj.numStartups, 3);
  assert.deepEqual(cj.mcpServers["blue-ai-bridge"].args.slice(-3), ["mcp", "--side", "claude"]);

  const t = fs.readFileSync(toml, "utf8");
  assert.match(t, /model = "gpt-6"/);
  assert.match(t, /\[mcp_servers\.other\]/);
  assert.match(t, /\[mcp_servers\.blue_ai_bridge\]/);
  assert.match(t, /tool_timeout_sec = 1800/);
  const ch = JSON.parse(fs.readFileSync(codexHooks, "utf8"));
  assert.equal(ch.hooks.UserPromptSubmit.flatMap((g: { hooks: unknown[] }) => g.hooks).length, 2);

  // again: nothing is duplicated
  await runInstall("install", "all");
  const s2 = JSON.parse(fs.readFileSync(claudeSettings, "utf8"));
  assert.equal(s2.hooks.Stop.flatMap((g: { hooks: unknown[] }) => g.hooks).length, 3);
  assert.equal(fs.readFileSync(toml, "utf8").match(/\[mcp_servers\.blue_ai_bridge\]/g)!.length, 1);
  assert.equal(s2.permissions.allow.filter((x: string) => x === "mcp__blue-ai-bridge").length, 1);

  const st = await installStatus();
  assert.equal(st.runtime.installed, true);
  assert.equal(st.targets.find((x) => x.id === "claude")!.installed, true);
  assert.equal(st.targets.find((x) => x.id === "codex")!.installed, true);
  assert.ok(r.backupDir && fs.readdirSync(r.backupDir).length >= 3, "backups written");
});

test("uninstall all restores the user's own config exactly", async () => {
  const r = await runInstall("uninstall", "all");
  assert.ok(r.steps.every((s) => s.ok), JSON.stringify(r.steps));
  const s = JSON.parse(fs.readFileSync(claudeSettings, "utf8"));
  assert.deepEqual(s, { theme: "dark", permissions: { allow: ["Bash(ls:*)"] }, hooks: { Stop: [{ hooks: [userHook] }] } });
  const cj = JSON.parse(fs.readFileSync(claudeJson, "utf8"));
  assert.deepEqual(Object.keys(cj.mcpServers), ["other"]);
  assert.equal(fs.readFileSync(toml, "utf8").trim(), 'model = "gpt-6"\n\n[mcp_servers.other]\ncommand = "x"');
  assert.deepEqual(JSON.parse(fs.readFileSync(codexHooks, "utf8")), { hooks: { UserPromptSubmit: [{ hooks: [userHook] }] } });
  assert.ok(!fs.existsSync(runtimeCli()));
});

test("a broken settings file is refused, not overwritten", async () => {
  fs.writeFileSync(claudeSettings, "{ not json");
  const r = await runInstall("install", "claude");
  const step = r.steps.find((s) => s.target === "claude")!;
  assert.equal(step.ok, false);
  assert.match(step.message, /not valid JSON/);
  assert.equal(fs.readFileSync(claudeSettings, "utf8"), "{ not json");
});
