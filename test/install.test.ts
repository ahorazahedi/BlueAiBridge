import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
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

test("the bridge bundled in the desktop app installs with its own Node.js", async () => {
  // <app>/bridge as scripts/bundle-bridge.sh lays it out, with this node standing in for the bundled one
  const app = fs.mkdtempSync(path.join(env.BLUE_AI_BRIDGE_HOME, "..", "app-"));
  const bridge = path.join(app, "bridge");
  const distRoot = path.resolve(import.meta.dirname, "..");
  fs.cpSync(distRoot, path.join(bridge, "dist"), { recursive: true, filter: (p) => !p.includes(`${path.sep}test${path.sep}`) && !p.endsWith(`${path.sep}test`) });
  fs.writeFileSync(path.join(bridge, "package.json"), JSON.stringify({ version: "0.0.0-test", type: "module" }));
  const exe = process.platform === "win32" ? "node.exe" : "node";
  fs.mkdirSync(path.join(bridge, "node"));
  fs.copyFileSync(process.execPath, path.join(bridge, "node", exe));
  fs.chmodSync(path.join(bridge, "node", exe), 0o755);

  const out = execFileSync(path.join(bridge, "node", exe), ["--no-warnings", path.join(bridge, "dist", "src", "cli.js"), "install"], { encoding: "utf8", env: process.env });
  assert.match(out, /desktop\s+the app is installed at/);
  const node = path.join(env.BLUE_AI_BRIDGE_HOME, "runtime", "node", process.versions.node, exe);
  assert.ok(fs.existsSync(node), "node copied into the runtime");
  // configs run the runtime's copy, not the app's (the app can be removed or moved)
  assert.ok(fs.readFileSync(toml, "utf8").includes(node), "Codex runs it");
  assert.equal(fs.readFileSync(path.join(env.BLUE_AI_BRIDGE_HOME, "runtime", "current", "node-path"), "utf8"), node);
  const s = JSON.parse(fs.readFileSync(claudeSettings, "utf8"));
  assert.ok(s.hooks.Stop.flatMap((g: { hooks: { command: string }[] }) => g.hooks).some((h: { command: string }) => h.command.startsWith(`"${node}"`)));

  const r = await runInstall("uninstall", "all");
  assert.ok(r.steps.every((x) => x.ok), JSON.stringify(r.steps));
  assert.ok(!fs.existsSync(node));
  fs.rmSync(app, { recursive: true, force: true });
});

test("a broken settings file is refused, not overwritten", async () => {
  fs.writeFileSync(claudeSettings, "{ not json");
  const r = await runInstall("install", "claude");
  const step = r.steps.find((s) => s.target === "claude")!;
  assert.equal(step.ok, false);
  assert.match(step.message, /not valid JSON/);
  assert.equal(fs.readFileSync(claudeSettings, "utf8"), "{ not json");
});
