// The Windows installer: PowerShell-safe Codex hooks and a logon task for the broker.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setupEnv } from "./helpers.js";
const { env } = setupEnv({ BLUE_AI_BRIDGE_PLATFORM: "win32" });
const { runInstall, windowsTaskArgs, windowsTaskScript, windowsTaskScriptBody, codexWindowsCmd } = await import("../src/install/installer.js");

test("windows: Codex hooks carry a PowerShell variant; the broker runs from a logon task", async () => {
  const r = await runInstall("install", "all");
  assert.ok(r.steps.every((s) => s.ok), JSON.stringify(r.steps));
  const hooks = JSON.parse(fs.readFileSync(path.join(env.CODEX_HOME, "hooks.json"), "utf8")).hooks;
  const stop = hooks.Stop[0].hooks[0];
  assert.match(stop.command, /^".*" --no-warnings ".*cli\.js" hook --app codex --event stop$/);
  assert.match(stop.commandWindows, /^& ".*" --no-warnings ".*cli\.js" hook --app codex --event stop$/);
  assert.equal(stop.commandWindows, codexWindowsCmd("stop"));
  const args = windowsTaskArgs();
  assert.deepEqual(args.slice(0, 7), ["/Create", "/F", "/SC", "ONLOGON", "/RL", "LIMITED", "/TN"]);
  assert.equal(args.at(-1), `"${windowsTaskScript()}"`);
  const body = fs.readFileSync(windowsTaskScript(), "utf8");
  assert.equal(body, windowsTaskScriptBody());
  assert.match(body, /set BLUE_AI_BRIDGE_SERVICE=1\r\n/);
  assert.match(body, /--no-warnings ".*cli\.js" broker >> ".*broker\.log" 2>&1/);
  assert.match(r.steps.find((s) => s.target === "menubar")!.message, /macOS only/);
  const u = await runInstall("uninstall", "all");
  assert.ok(u.steps.every((s) => s.ok));
  assert.ok(!fs.existsSync(windowsTaskScript()));
});
