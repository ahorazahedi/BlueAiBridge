// `blueai doctor`: checks every piece the bridge relies on and prints a fix
// for each problem. Never changes anything.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { paths } from "../shared/paths.js";
import { IS_MAC, IS_LINUX, IS_WIN, appInstalled, locateClaude, locateCodex } from "../shared/platform.js";
import { installStatus, runtimeCli } from "./installer.js";
import { loadConfig, loadRules, RULES_MAX } from "../shared/config.js";
import { AppServer } from "../delivery/appserver.js";

export interface Check {
  group: string;
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  fix?: string;
}

const REINSTALL = "Reinstall from the dashboard (Clients → Install), or run `blueai install`.";

export async function runDoctor(opts: { brokerUp?: boolean; deep?: boolean } = {}): Promise<{ checks: Check[]; ok: boolean; summary: Record<string, number> }> {
  const checks: Check[] = [];
  const add = (group: string, name: string, status: Check["status"], detail: string, fix?: string) => checks.push({ group, name, status, detail, ...(fix && { fix }) });

  // ---- system ----
  const major = Number(process.versions.node.split(".")[0]);
  const minor = Number(process.versions.node.split(".")[1]);
  major > 22 || (major === 22 && minor >= 5) ? add("System", "Node.js", "ok", process.versions.node) : add("System", "Node.js", "fail", `${process.versions.node} (needs 22.5+)`, "Install Node.js 22 LTS or newer.");
  try {
    add("System", "git", "ok", execFileSync("git", ["--version"], { encoding: "utf8" }).trim());
  } catch {
    add("System", "git", "fail", "not found", "Install git (xcode-select --install).");
  }

  // ---- runtime & broker ----
  const st = await installStatus();
  st.runtime.installed
    ? add("BlueAIBridge", "runtime", st.runtime.upToDate ? "ok" : "warn", `v${st.runtime.version} at ${st.runtime.path}`, st.runtime.upToDate ? undefined : `This build is v${st.version}. ${REINSTALL}`)
    : add("BlueAIBridge", "runtime", "fail", "not installed", REINSTALL);
  if (st.runtime.installed && !fs.existsSync(runtimeCli())) add("BlueAIBridge", "runtime files", "fail", `${runtimeCli()} is missing`, REINSTALL);
  add("BlueAIBridge", "broker", opts.brokerUp ? "ok" : "warn", opts.brokerUp ? `running on 127.0.0.1:${loadConfig().port}` : "not running (starts on demand)");
  const svc = st.targets.find((t) => t.id === "service")!;
  const svcKind = IS_MAC ? "LaunchAgent" : IS_LINUX ? "systemd user service" : IS_WIN ? "logon task" : null;
  if (svcKind)
    svc.installed
      ? add("BlueAIBridge", "background service", "ok", `${svcKind} installed`)
      : add("BlueAIBridge", "background service", "warn", "not installed: the dashboard is only up while a chat uses the bridge", "Install the Background service (Clients & install, or `blueai install service`).");
  if (IS_MAC) {
    const app = st.targets.find((t) => t.id === "menubar");
    app?.installed ? add("BlueAIBridge", "macOS app", "ok", String(app.details.app)) : add("BlueAIBridge", "macOS app", "warn", "not installed", "Run `npm run build:mac`, then `blueai install menubar`.");
  }
  const rules = loadRules();
  add("BlueAIBridge", "rules.md", "ok", rules ? `${rules.length}/${RULES_MAX} characters` : "none (optional)");

  // ---- Claude ----
  const claude = st.targets.find((t) => t.id === "claude")!;
  const cbin = locateClaude();
  cbin ? add("Claude", "Claude Code CLI", "ok", `${cbin.path} (${cbin.source})`) : add("Claude", "Claude Code CLI", "fail", "not found", "Install Claude Desktop or Claude Code; headless questions to Claude need it.");
  add("Claude", "Claude Desktop", appInstalled("Claude") ? "ok" : "warn", appInstalled("Claude") ? "installed" : "not installed");
  const cd = claude.details as { mcp: boolean; hooks: string; permission: boolean };
  add("Claude", "MCP server", cd.mcp ? "ok" : "fail", cd.mcp ? "registered (user scope)" : "not registered", cd.mcp ? undefined : REINSTALL);
  add("Claude", "hooks", Number(cd.hooks.split("/")[0]) >= 7 ? "ok" : Number(cd.hooks.split("/")[0]) > 0 ? "warn" : "fail", `${cd.hooks} installed`, Number(cd.hooks.split("/")[0]) >= 7 ? undefined : REINSTALL);
  add("Claude", "tool permission", cd.permission ? "ok" : "warn", cd.permission ? "bridge tools run without prompts" : "bridge tools will ask for approval", cd.permission ? undefined : "A woken chat can't wait for a click. " + REINSTALL);

  // ---- ChatGPT / Codex ----
  const codex = st.targets.find((t) => t.id === "codex")!;
  const xbin = locateCodex();
  xbin ? add("ChatGPT", "codex CLI", "ok", `${xbin.path} (${xbin.source})`) : add("ChatGPT", "codex CLI", "fail", "not found", "Install ChatGPT Desktop (it bundles the codex CLI) or the Codex CLI.");
  add("ChatGPT", "ChatGPT Desktop", appInstalled("ChatGPT") ? "ok" : "warn", appInstalled("ChatGPT") ? "installed" : "not installed: visible delivery is off; headless still works");
  const xd = codex.details as { mcp: boolean; hooks: string; toolTimeout: string | null };
  add("ChatGPT", "MCP server", xd.mcp ? "ok" : "fail", xd.mcp ? `registered (${xd.toolTimeout ?? "default timeout"})` : "not in ~/.codex/config.toml", xd.mcp ? undefined : REINSTALL);
  add("ChatGPT", "hooks", Number(xd.hooks.split("/")[0]) >= 3 ? "ok" : "fail", `${xd.hooks} in ~/.codex/hooks.json`, Number(xd.hooks.split("/")[0]) >= 3 ? undefined : REINSTALL);

  if (xbin && opts.deep !== false && !process.env.BLUE_AI_BRIDGE_FAKE_CODEX) {
    let s: AppServer | null = null;
    try {
      s = await Promise.race([AppServer.open(20_000), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("app-server didn't start in 20 s")), 20_000))]);
      try {
        await s.rpc("thread/queue/list", { threadId: "00000000-0000-0000-0000-000000000000" }, 10_000);
        add("ChatGPT", "thread queue API", "ok", "available (experimental)");
      } catch (e) {
        /method not found|unknown method|unknown variant/i.test((e as Error).message)
          ? add("ChatGPT", "thread queue API", "fail", "missing in this app version", "Visible delivery to ChatGPT can't work with this version; headless still does.")
          : add("ChatGPT", "thread queue API", "ok", "available (experimental)");
      }
      try {
        const listed = (await s.rpc<{ data: { hooks: { eventName: string; command?: string; enabled?: boolean; trustStatus?: string }[] }[] }>("hooks/list", { cwds: [paths.root()] }, 15_000)).data.flatMap((e) => e.hooks);
        for (const [ev, kind] of [["stop", "stop"], ["userPromptSubmit", "prompt"], ["sessionStart", "start"]] as const) {
          const h = listed.find((x) => x.eventName === ev && x.command?.includes(`--event ${kind}`) && /blueaibridge/i.test(x.command));
          if (!h) add("ChatGPT", `${ev} hook`, xd.mcp ? "fail" : "warn", "not loaded by Codex", "Restart ChatGPT Desktop; " + REINSTALL);
          else if (h.enabled === false) add("ChatGPT", `${ev} hook`, "fail", "disabled in Codex", "Enable it in ChatGPT's hook settings.");
          else if (h.trustStatus && h.trustStatus !== "trusted" && h.trustStatus !== "managed")
            add("ChatGPT", `${ev} hook`, "fail", `${h.trustStatus}: Codex skips it`, "Open ChatGPT Desktop with its window, review and trust the BlueAIBridge hooks in its hook settings, then restart it.");
          else add("ChatGPT", `${ev} hook`, "ok", "trusted");
        }
      } catch (e) {
        add("ChatGPT", "hook trust", "warn", `couldn't list hooks (${(e as Error).message})`);
      }
    } catch (e) {
      add("ChatGPT", "app-server", "warn", (e as Error).message, "Update ChatGPT Desktop; visible delivery needs its bundled app-server.");
    } finally {
      s?.close();
    }
  }

  // ---- files ----
  for (const [name, dir] of [
    ["state folder", paths.data()],
    ["logs", paths.logs()],
  ] as const) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      add("Files", name, "ok", dir);
    } catch {
      add("Files", name, "fail", `${dir} is not writable`, `Fix the permissions of ${path.dirname(dir)}.`);
    }
  }
  const summary = { ok: checks.filter((c) => c.status === "ok").length, warn: checks.filter((c) => c.status === "warn").length, fail: checks.filter((c) => c.status === "fail").length };
  return { checks, ok: summary.fail === 0, summary };
}
