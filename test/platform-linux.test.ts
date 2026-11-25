// The Linux installer: a systemd user unit for the broker; no native app.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setupEnv } from "./helpers.js";
const { env } = setupEnv({ BLUE_AI_BRIDGE_PLATFORM: "linux", XDG_CONFIG_HOME: "" });
delete process.env.XDG_CONFIG_HOME;
const { runInstall, installStatus, systemdUnit, runtimeCli } = await import("../src/install/installer.js");
const { paths } = await import("../src/shared/paths.js");

test("linux: service is a systemd user unit; the native app is skipped", async () => {
  const r = await runInstall("install", "all");
  assert.ok(r.steps.every((s) => s.ok), JSON.stringify(r.steps));
  const unitFile = path.join(env.BLUE_AI_BRIDGE_USER_HOME, ".config", "systemd", "user", "blueaibridge.service");
  assert.equal(paths.systemdUnit(), unitFile);
  const unit = fs.readFileSync(unitFile, "utf8");
  assert.match(unit, new RegExp(`ExecStart=.* --no-warnings ${runtimeCli().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} broker`));
  assert.match(unit, /Environment=BLUE_AI_BRIDGE_SERVICE=1/);
  assert.match(unit, /Restart=on-failure/);
  assert.match(unit, /WantedBy=default\.target/);
  assert.match(r.steps.find((s) => s.target === "menubar")!.message, /macOS only/);
  const st = await installStatus();
  assert.equal(st.targets.find((t) => t.id === "service")!.installed, true);
  assert.ok(!st.targets.some((t) => t.id === "menubar"), "no native app target on Linux");
  assert.equal(systemdUnit(), unit);
  const u = await runInstall("uninstall", "all");
  assert.ok(u.steps.every((s) => s.ok));
  assert.ok(!fs.existsSync(unitFile));
});
