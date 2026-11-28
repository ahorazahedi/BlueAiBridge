// Install and uninstall BlueAIBridge for each client, idempotently, with a
// backup of every file it changes. Targets:
//   runtime  copies the built app to ~/.blueaibridge/runtime (configs point there, so the source folder can move),
//            plus the Node.js binary when it runs from the copy bundled inside the desktop app
//   claude   Claude Desktop (Code tab) + Claude Code CLI: MCP server (user scope), hooks, tool permission
//   codex    ChatGPT Desktop + Codex CLI: MCP server in ~/.codex/config.toml, hooks in ~/.codex/hooks.json
//   service  a LaunchAgent that keeps the broker (and the dashboard) running (macOS)
//   menubar  the BlueAIBridge menu-bar app in ~/Applications (macOS, when built)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { paths, HOME } from "../shared/paths.js";
import { IS_LINUX, IS_MAC, IS_WIN, PLATFORM, appInstalled, locateClaude, locateCodex, locateCodexStandalone } from "../shared/platform.js";
import { VERSION } from "../version.js";

export type Target = "runtime" | "claude" | "codex" | "service" | "menubar" | "desktop";
export const TARGETS: Target[] = ["runtime", "claude", "codex", "service", "menubar", "desktop"];
const SERVER_NAME = "blue-ai-bridge";
const CODEX_NAME = "blue_ai_bridge";
const BEGIN = "# >>> blue-ai-bridge (managed by BlueAIBridge — use its dashboard or `blueai uninstall` to change)";
const END = "# <<< blue-ai-bridge";
const LABEL = "com.blueaibridge.broker";

export interface StepResult {
  target: Target;
  ok: boolean;
  message: string;
}
export interface InstallResult {
  ok: boolean;
  action: "install" | "uninstall";
  steps: StepResult[];
  backupDir: string | null;
}

// ---------------------------------------------------------------------
// where things are
// ---------------------------------------------------------------------

/** The project (or runtime) root this code runs from: <root>/dist/src/install/installer.js */
const SELF_ROOT = path.resolve(import.meta.dirname, "../../..");
export const runtimeRoot = () => path.join(paths.runtime(), "current");
export const runtimeCli = () => path.join(runtimeRoot(), "dist", "src", "cli.js");

const NODE_EXE = IS_WIN ? "node.exe" : "node";
/** The Node.js binary shipped next to this code inside the desktop app (<app>/bridge/node/node), if any. */
export const bundledNode = (): string | null => {
  const p = path.join(SELF_ROOT, "node", NODE_EXE);
  return fs.existsSync(p) ? p : null;
};
/** Where the runtime keeps its copy of the bundled node. Versioned, so a newer app never has to
 * overwrite a node.exe that a running broker, hook or MCP server still holds open (Windows). */
export const runtimeNode = () => path.join(paths.runtime(), "node", process.versions.node, NODE_EXE);

/** The node binary the configs run: the runtime's copy of the bundled one, else the node running
 * us (its stable Homebrew symlink when it points at us, so it survives upgrades). */
export function nodePath(): string {
  if (process.env.BLUE_AI_BRIDGE_NODE) return process.env.BLUE_AI_BRIDGE_NODE;
  if (bundledNode() || (fs.existsSync(runtimeNode()) && fs.realpathSync(runtimeNode()) === fs.realpathSync(process.execPath))) return runtimeNode();
  for (const cand of ["/opt/homebrew/bin/node", "/usr/local/bin/node"]) {
    try {
      if (fs.realpathSync(cand) === fs.realpathSync(process.execPath)) return cand;
    } catch {
      /* not there */
    }
  }
  return process.execPath;
}

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
const hookCmd = (app: "claude" | "codex", event: string) => `${q(nodePath())} --no-warnings ${q(runtimeCli())} hook --app ${app} --event ${event}`;
// ours: any BlueAIBridge runtime's cli.js running a hook, wherever it was installed
const isOurs = (cmd: unknown) => typeof cmd === "string" && /[\\/]dist[\\/]src[\\/]cli\.js"?\s+hook --app (claude|codex) --event \w+/.test(cmd);

let backupDir: string | null = null;
function backup(file: string) {
  if (!fs.existsSync(file)) return;
  backupDir ??= path.join(paths.backups(), new Date().toISOString().replace(/[:.]/g, "-"));
  const dest = path.join(backupDir, file.replace(HOME(), "~").replace(/[\\/]/g, "__"));
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(file, dest);
}

function readJsonFile(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, "utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${file} is not valid JSON (${(e as Error).message}); fix it first, nothing was changed`);
  }
}
function writeJsonFile(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.blueai-tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------
// hooks (same JSON shape in Claude's settings.json and Codex's hooks.json)
// ---------------------------------------------------------------------

type HookEntry = { type: "command"; command: string; commandWindows?: string; timeout?: number; asyncRewake?: boolean };
type HookGroup = { matcher?: string; hooks: HookEntry[] };

function claudeHooks(): Record<string, HookGroup[]> {
  const quick = (event: string): HookEntry => ({ type: "command", command: hookCmd("claude", event), timeout: 10 });
  const listener: HookEntry = { type: "command", command: hookCmd("claude", "listen"), asyncRewake: true, timeout: 12 * 3600 };
  return {
    Stop: [{ hooks: [quick("stop"), listener] }],
    StopFailure: [{ hooks: [quick("stopfail")] }],
    SessionStart: [{ hooks: [listener, quick("start")] }],
    UserPromptSubmit: [{ hooks: [quick("prompt")] }],
    Notification: [{ matcher: "permission_prompt", hooks: [quick("permission")] }],
  };
}
/**
 * Codex on Windows runs hook commands in PowerShell, where a line that starts
 * with a quoted path is a parse error: the call operator `&` makes it a command.
 */
export const codexWindowsCmd = (event: string) => `& ${q(nodePath())} --no-warnings ${q(runtimeCli())} hook --app codex --event ${event}`;

function codexHooks(): Record<string, HookGroup[]> {
  const quick = (event: string): HookEntry => ({ type: "command", command: hookCmd("codex", event), ...(IS_WIN && { commandWindows: codexWindowsCmd(event) }), timeout: 10 });
  return { Stop: [{ hooks: [quick("stop")] }], UserPromptSubmit: [{ hooks: [quick("prompt")] }], SessionStart: [{ hooks: [quick("start")] }] };
}

function setHooks(cfg: Record<string, unknown>, wanted: Record<string, HookGroup[]> | null) {
  const hooks = ((cfg.hooks as Record<string, HookGroup[]>) ?? {}) as Record<string, HookGroup[]>;
  for (const ev of Object.keys(hooks)) {
    hooks[ev] = (hooks[ev] ?? []).map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOurs(h.command)) })).filter((g) => g.hooks.length);
    if (!hooks[ev].length) delete hooks[ev];
  }
  if (wanted) for (const [ev, groups] of Object.entries(wanted)) hooks[ev] = [...(hooks[ev] ?? []), ...groups];
  if (Object.keys(hooks).length) cfg.hooks = hooks;
  else delete cfg.hooks;
  return cfg;
}

function countOurHooks(cfg: Record<string, unknown>): number {
  const hooks = (cfg.hooks as Record<string, HookGroup[]>) ?? {};
  return Object.values(hooks).flatMap((gs) => gs.flatMap((g) => g.hooks ?? [])).filter((h) => isOurs(h.command)).length;
}

// ---------------------------------------------------------------------
// targets
// ---------------------------------------------------------------------

function installRuntime(action: "install" | "uninstall"): StepResult {
  const dest = runtimeRoot();
  if (action === "uninstall") {
    fs.rmSync(paths.runtime(), { recursive: true, force: true });
    return { target: "runtime", ok: true, message: `removed ${paths.runtime()}` };
  }
  const src = SELF_ROOT;
  if (path.resolve(src) === path.resolve(dest)) return { target: "runtime", ok: true, message: `running from the installed runtime (${dest}); nothing to copy` };
  if (!fs.existsSync(path.join(src, "dist", "src", "cli.js"))) throw new Error("build first: npm run build");
  if (!fs.existsSync(path.join(src, "dist", "dashboard", "index.html"))) throw new Error("the dashboard isn't built: npm run build");
  const node = bundledNode();
  if (node && !fs.existsSync(runtimeNode())) {
    const tmp = `${runtimeNode()}.tmp-${process.pid}`;
    fs.mkdirSync(path.dirname(runtimeNode()), { recursive: true });
    fs.copyFileSync(node, tmp);
    fs.chmodSync(tmp, 0o755);
    fs.renameSync(tmp, runtimeNode());
  }
  if (node) {
    // drop node versions older apps left behind; one still in use (Windows) stays until next time
    for (const v of fs.readdirSync(path.join(paths.runtime(), "node"))) {
      if (v === process.versions.node) continue;
      try {
        fs.rmSync(path.join(paths.runtime(), "node", v), { recursive: true, force: true });
      } catch {
        /* still running */
      }
    }
  }
  const staging = path.join(paths.runtime(), `staging-${process.pid}`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  fs.cpSync(path.join(src, "dist"), path.join(staging, "dist"), { recursive: true, filter: (p) => !p.includes(`${path.sep}test${path.sep}`) && !p.endsWith(".map") });
  fs.writeFileSync(path.join(staging, "package.json"), JSON.stringify({ name: "blue-ai-bridge-runtime", version: VERSION, type: "module", private: true }, null, 2));
  // the menu-bar app starts the broker with this node
  fs.writeFileSync(path.join(staging, "node-path"), nodePath());
  const macApp = path.join(src, "macos", "build", "BlueAIBridge.app");
  if (fs.existsSync(macApp)) fs.cpSync(macApp, path.join(staging, "BlueAIBridge.app"), { recursive: true, verbatimSymlinks: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(staging, dest);
  return { target: "runtime", ok: true, message: `installed v${VERSION} to ${dest}` };
}

function installClaude(action: "install" | "uninstall"): StepResult {
  const notes: string[] = [];
  // 1) MCP server, user scope (every project, Claude Desktop's Code tab and the CLI)
  const spec = { type: "stdio", command: nodePath(), args: ["--no-warnings", runtimeCli(), "mcp", "--side", "claude"], env: {} };
  const cli = locateClaude();
  let viaCli = false;
  if (cli && !process.env.BLUE_AI_BRIDGE_NO_CLAUDE_CLI) {
    try {
      try {
        execFileSync(cli.path, ["mcp", "remove", SERVER_NAME, "-s", "user"], { stdio: "ignore", timeout: 30_000 });
      } catch {
        /* wasn't there */
      }
      if (action === "install") execFileSync(cli.path, ["mcp", "add-json", SERVER_NAME, JSON.stringify(spec), "-s", "user"], { stdio: "ignore", timeout: 30_000 });
      viaCli = true;
    } catch (e) {
      notes.push(`claude CLI failed (${(e as Error).message.split("\n")[0]}); edited ~/.claude.json directly`);
    }
  }
  if (!viaCli) {
    const file = paths.claudeJson();
    const cfg = readJsonFile(file);
    backup(file);
    const servers = (cfg.mcpServers as Record<string, unknown>) ?? {};
    if (action === "install") servers[SERVER_NAME] = spec;
    else delete servers[SERVER_NAME];
    cfg.mcpServers = servers;
    writeJsonFile(file, cfg);
  }
  // 2) hooks + permission in ~/.claude/settings.json
  const file = path.join(paths.claudeDir(), "settings.json");
  const cfg = readJsonFile(file);
  backup(file);
  const perms = ((cfg.permissions as Record<string, unknown>) ?? {}) as { allow?: string[] };
  const rule = `mcp__${SERVER_NAME}`;
  const allow = (perms.allow ?? []).filter((r) => r !== rule);
  if (action === "install") allow.push(rule);
  if (allow.length) perms.allow = allow;
  else delete perms.allow;
  if (Object.keys(perms).length) cfg.permissions = perms;
  else delete cfg.permissions;
  setHooks(cfg, action === "install" ? claudeHooks() : null);
  writeJsonFile(file, cfg);
  return {
    target: "claude",
    ok: true,
    message: `${action === "install" ? "registered" : "removed"} the MCP server${viaCli ? " (claude mcp)" : ""}, hooks and tool permission in ${file}${notes.length ? `; ${notes.join("; ")}` : ""}`,
  };
}

function installCodex(action: "install" | "uninstall"): StepResult {
  const cfgFile = path.join(paths.codexHome(), "config.toml");
  let text = fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile, "utf8") : "";
  backup(cfgFile);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  text = text.replace(new RegExp(`\\n*${esc(BEGIN.slice(0, 22))}[^\\n]*\\n[\\s\\S]*?${esc(END)}\\n?`, "g"), "\n");
  if (action === "install") {
    const lit = (s: string) => `'${s}'`; // TOML literal strings: no escaping
    text =
      text.trimEnd() +
      `\n\n${BEGIN}\n[mcp_servers.${CODEX_NAME}]\ncommand = ${lit(nodePath())}\nargs = ["--no-warnings", ${lit(runtimeCli())}, "mcp", "--side", "codex"]\n` +
      `# reviews and questions can take many minutes\ntool_timeout_sec = 1800\nstartup_timeout_sec = 30\n` +
      `# a woken reviewer can't stop for an approval click on every call\ndefault_tools_approval_mode = "approve"\n${END}\n`;
  }
  fs.mkdirSync(path.dirname(cfgFile), { recursive: true });
  fs.writeFileSync(cfgFile, text.replace(/^\n+/, ""));
  const hooksFile = path.join(paths.codexHome(), "hooks.json");
  const cfg = readJsonFile(hooksFile);
  backup(hooksFile);
  setHooks(cfg, action === "install" ? codexHooks() : null);
  if (Object.keys(cfg).length) writeJsonFile(hooksFile, cfg);
  else fs.rmSync(hooksFile, { force: true });
  return {
    target: "codex",
    ok: true,
    message:
      action === "install"
        ? `registered the MCP server in ${cfgFile} and hooks in ${hooksFile}. Restart ChatGPT Desktop with its window open and trust the BlueAIBridge hooks when it asks.`
        : `removed BlueAIBridge from ${cfgFile} and ${hooksFile}`,
  };
}

const SERVICE_ENV = "BLUE_AI_BRIDGE_SERVICE";
const servicePath = () => ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin", path.join(HOME(), ".local", "bin")].join(":");

export function plist(): string {
  const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${x(nodePath())}</string>
    <string>--no-warnings</string>
    <string>${x(runtimeCli())}</string>
    <string>broker</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${x(servicePath())}</string>
    <key>HOME</key><string>${x(HOME())}</string>
    <key>${SERVICE_ENV}</key><string>1</string>
  </dict>
  <key>WorkingDirectory</key><string>${x(paths.root())}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${x(paths.brokerLog())}</string>
  <key>StandardErrorPath</key><string>${x(paths.brokerLog())}</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
`;
}

/** systemd user unit (Linux): restarts the broker when it fails, starts it at login. */
export function systemdUnit(): string {
  const e = (s: string) => (/[\s"\\]/.test(s) ? `"${s.replace(/(["\\])/g, "\\$1")}"` : s);
  return `[Unit]
Description=BlueAIBridge broker (Claude Code <-> ChatGPT/Codex)
After=default.target

[Service]
Type=simple
ExecStart=${e(nodePath())} --no-warnings ${e(runtimeCli())} broker
WorkingDirectory=${paths.root()}
Environment=${SERVICE_ENV}=1
Environment=PATH=${servicePath()}
Restart=on-failure
RestartSec=10
StandardOutput=append:${paths.brokerLog()}
StandardError=append:${paths.brokerLog()}

[Install]
WantedBy=default.target
`;
}

const WIN_TASK = "BlueAIBridge Broker";

/** The Windows logon task: what schtasks is given (exposed for tests). */
export function windowsTaskArgs(): string[] {
  // the task runs a tiny .cmd so the service env is set and paths with spaces stay quoted
  return ["/Create", "/F", "/SC", "ONLOGON", "/RL", "LIMITED", "/TN", WIN_TASK, "/TR", `"${windowsTaskScript()}"`];
}
export const windowsTaskScript = () => path.join(paths.root(), "broker.cmd");
export function windowsTaskScriptBody(): string {
  return `@echo off\r\nset ${SERVICE_ENV}=1\r\ncd /d "${paths.root()}"\r\n"${nodePath()}" --no-warnings "${runtimeCli()}" broker >> "${paths.brokerLog()}" 2>&1\r\n`;
}

/** Run an OS service command; skipped in tests. Returns false when it failed. */
function sys(cmd: string, args: string[]): boolean {
  if (process.env.BLUE_AI_BRIDGE_NO_LAUNCHCTL) return true;
  try {
    execFileSync(cmd, args, { stdio: "ignore", timeout: 20_000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function stopRunningBroker() {
  try {
    const pid = Number(fs.readFileSync(paths.pid(), "utf8").trim());
    if (pid > 0 && pid !== process.pid) process.kill(pid, "SIGTERM");
  } catch {
    /* not running */
  }
}

export function serviceInstalled(): boolean {
  if (IS_MAC) return fs.existsSync(paths.launchAgent());
  if (IS_LINUX) return fs.existsSync(paths.systemdUnit());
  if (IS_WIN) return fs.existsSync(paths.windowsTask());
  return false;
}

function installService(action: "install" | "uninstall"): StepResult {
  fs.mkdirSync(paths.logs(), { recursive: true });
  if (IS_MAC) {
    const file = paths.launchAgent();
    const domain = `gui/${os.userInfo().uid}`;
    sys("launchctl", ["bootout", `${domain}/${LABEL}`]);
    if (action === "uninstall") {
      fs.rmSync(file, { force: true });
      return { target: "service", ok: true, message: "removed the LaunchAgent; the broker now starts on demand" };
    }
    stopRunningBroker(); // a broker started on demand would hold the port
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, plist());
    // bootout is asynchronous: wait until the old job is gone, then load the new one and check it stays
    const loaded = () => sys("launchctl", ["print", `${domain}/${LABEL}`]);
    let ok = !!process.env.BLUE_AI_BRIDGE_NO_LAUNCHCTL;
    for (let i = 0; i < 40 && !ok && loaded(); i++) sleepSync(250);
    for (let i = 0; i < 10 && !ok; i++) {
      sys("launchctl", ["bootstrap", domain, file]);
      sleepSync(400);
      ok = loaded();
    }
    if (ok) sys("launchctl", ["kickstart", `${domain}/${LABEL}`]);
    return ok
      ? { target: "service", ok: true, message: `LaunchAgent ${LABEL} keeps the broker and dashboard running (${file})` }
      : { target: "service", ok: false, message: `wrote ${file}, but launchctl didn't load it; run: launchctl bootstrap ${domain} ${file}` };
  }
  if (IS_LINUX) {
    const file = paths.systemdUnit();
    if (action === "uninstall") {
      sys("systemctl", ["--user", "disable", "--now", "blueaibridge.service"]);
      fs.rmSync(file, { force: true });
      sys("systemctl", ["--user", "daemon-reload"]);
      return { target: "service", ok: true, message: "removed the systemd user service; the broker now starts on demand" };
    }
    stopRunningBroker();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, systemdUnit());
    const ok = sys("systemctl", ["--user", "daemon-reload"]) && sys("systemctl", ["--user", "enable", "--now", "blueaibridge.service"]);
    return {
      target: "service",
      ok,
      message: ok ? `systemd user service blueaibridge.service keeps the broker and dashboard running (${file})` : `wrote ${file}, but systemctl --user failed (no user session bus?); the broker still starts on demand`,
    };
  }
  if (IS_WIN) {
    if (action === "uninstall") {
      sys("schtasks", ["/End", "/TN", WIN_TASK]);
      sys("schtasks", ["/Delete", "/F", "/TN", WIN_TASK]);
      stopRunningBroker();
      fs.rmSync(paths.windowsTask(), { force: true });
      fs.rmSync(windowsTaskScript(), { force: true });
      return { target: "service", ok: true, message: "removed the logon task; the broker now starts on demand" };
    }
    fs.mkdirSync(paths.root(), { recursive: true });
    fs.writeFileSync(windowsTaskScript(), windowsTaskScriptBody());
    stopRunningBroker();
    const ok = sys("schtasks", windowsTaskArgs());
    if (ok) {
      fs.writeFileSync(paths.windowsTask(), WIN_TASK);
      sys("schtasks", ["/Run", "/TN", WIN_TASK]);
    }
    return { target: "service", ok, message: ok ? `logon task "${WIN_TASK}" keeps the broker and dashboard running` : "schtasks failed; the broker still starts on demand" };
  }
  return { target: "service", ok: true, message: `skipped (no service manager for ${PLATFORM}); the broker starts on demand` };
}

const menubarDest = () => paths.macApp();

/** The native macOS app (window + menu-bar icon). Other platforms use the web dashboard. */
function installMenubar(action: "install" | "uninstall"): StepResult {
  if (!IS_MAC) return { target: "menubar", ok: true, message: "skipped: the native app is macOS only; use the web dashboard (`blueai ui`)" };
  // running from the bridge inside BlueAIBridge.app/Contents/Resources/bridge: that app is the one
  // the user installed (and is running): keep it where it is, only start it at login
  const bundledApp = bundledNode() ? path.resolve(SELF_ROOT, "..", "..", "..") : null;
  const dest = action === "install" && bundledApp?.endsWith(".app") ? bundledApp : menubarDest();
  const label = "com.blueaibridge.app";
  const loginItem = path.join(HOME(), "Library", "LaunchAgents", `${label}.plist`);
  const quitRunning = () => {
    if (!process.env.BLUE_AI_BRIDGE_NO_LAUNCHCTL)
      try {
        execFileSync("pkill", ["-x", "BlueAIBridge"], { stdio: "ignore" });
      } catch {
        /* not running */
      }
  };
  // the earlier menu-bar-only build used another label: remove it either way
  const oldItem = path.join(HOME(), "Library", "LaunchAgents", "com.blueaibridge.menubar.plist");
  sys("launchctl", ["bootout", `gui/${os.userInfo().uid}/com.blueaibridge.menubar`]);
  fs.rmSync(oldItem, { force: true });
  sys("launchctl", ["bootout", `gui/${os.userInfo().uid}/${label}`]);
  if (action === "uninstall") {
    if (fs.existsSync(dest)) quitRunning();
    fs.rmSync(loginItem, { force: true });
    fs.rmSync(dest, { recursive: true, force: true });
    return { target: "menubar", ok: true, message: `removed ${dest}` };
  }
  const src = dest === bundledApp ? dest : [path.join(runtimeRoot(), "BlueAIBridge.app"), path.join(SELF_ROOT, "macos", "build", "BlueAIBridge.app")].find((p) => fs.existsSync(p));
  if (!src) return { target: "menubar", ok: false, message: "the macOS app isn't built: run `npm run build:mac` (needs Xcode's Swift), then install again" };
  if (dest !== bundledApp) quitRunning();
  if (path.resolve(src) !== path.resolve(dest)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true, verbatimSymlinks: true });
  }
  // at login: only the menu-bar icon (no window)
  fs.mkdirSync(path.dirname(loginItem), { recursive: true });
  fs.writeFileSync(
    loginItem,
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>/usr/bin/open</string><string>-g</string><string>-a</string><string>${dest}</string><string>--args</string><string>--background</string></array><key>RunAtLoad</key><true/></dict></plist>\n`,
  );
  sys("launchctl", ["bootstrap", `gui/${os.userInfo().uid}`, loginItem]);
  if (dest === bundledApp) return { target: "menubar", ok: true, message: `the app is installed at ${dest} (menu-bar icon at login)` };
  sys("open", ["-g", "-a", dest, "--args", "--background"]);
  return { target: "menubar", ok: true, message: `installed ${dest} (menu-bar icon at login; open it from Applications or the icon)` };
}

// ---------------------------------------------------------------------
// the Flutter desktop app (Windows, Linux)
// ---------------------------------------------------------------------

export const desktopAppDir = () =>
  IS_WIN ? path.join(process.env.LOCALAPPDATA || path.join(HOME(), "AppData", "Local"), "Programs", "BlueAIBridge") : path.join(HOME(), ".local", "share", "blueaibridge", "app");
const desktopExe = () => path.join(desktopAppDir(), IS_WIN ? "blue_ai_bridge.exe" : "blue_ai_bridge");
// named after the app's GTK application id, so GNOME and KDE match its windows to this entry (and its icon)
const LINUX_APP_ID = "com.blueaibridge.blue_ai_bridge";
const linuxDesktopFile = () => path.join(HOME(), ".local", "share", "applications", `${LINUX_APP_ID}.desktop`);
const legacyLinuxDesktopFile = () => path.join(HOME(), ".local", "share", "applications", "blueaibridge.desktop");
const linuxAutostartFile = () => path.join(process.env.XDG_CONFIG_HOME || path.join(HOME(), ".config"), "autostart", "blueaibridge.desktop");
const winStartMenu = () => path.join(process.env.APPDATA || path.join(HOME(), "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", "BlueAIBridge.lnk");
const winStartup = () => path.join(process.env.APPDATA || path.join(HOME(), "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "BlueAIBridge.lnk");

/** Where a locally built Flutter bundle is (`flutter build linux|windows --release`). */
function desktopBuild(): string | null {
  if (process.env.BLUE_AI_BRIDGE_DESKTOP_BUILD) return fs.existsSync(process.env.BLUE_AI_BRIDGE_DESKTOP_BUILD) ? process.env.BLUE_AI_BRIDGE_DESKTOP_BUILD : null;
  const root = path.join(SELF_ROOT, "desktop", "build");
  const cands = IS_WIN
    ? [path.join(root, "windows", "x64", "runner", "Release")]
    : ["x64", "arm64"].map((a) => path.join(root, "linux", a, "release", "bundle"));
  return cands.find((c) => fs.existsSync(c)) ?? null;
}

export function linuxDesktopEntry(background: boolean): string {
  return `[Desktop Entry]
Type=Application
Name=BlueAIBridge
Comment=Claude Code and ChatGPT review and talk to each other
Exec="${desktopExe()}"${background ? " --background" : ""}
Icon=${path.join(desktopAppDir(), "data", "flutter_assets", "assets", "app_icon.png")}
Categories=Development;
StartupWMClass=${LINUX_APP_ID}
Terminal=false
${background ? "X-GNOME-Autostart-enabled=true\n" : ""}`;
}

function winShortcut(lnk: string, target: string, args: string): boolean {
  const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${lnk.replace(/'/g, "''")}');$s.TargetPath='${target.replace(/'/g, "''")}';$s.Arguments='${args}';$s.WorkingDirectory='${path.dirname(target).replace(/'/g, "''")}';$s.Save()`;
  return sys("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps]);
}

function installDesktop(action: "install" | "uninstall"): StepResult {
  if (IS_MAC) return { target: "desktop", ok: true, message: "skipped: macOS uses the native Swift app (the menubar target)" };
  if (!IS_WIN && !IS_LINUX) return { target: "desktop", ok: true, message: `skipped (no desktop app for ${PLATFORM}); use the web dashboard` };
  const dir = desktopAppDir();
  if (action === "uninstall") {
    if (IS_LINUX) {
      fs.rmSync(linuxDesktopFile(), { force: true });
      fs.rmSync(legacyLinuxDesktopFile(), { force: true });
      fs.rmSync(linuxAutostartFile(), { force: true });
      sys("pkill", ["-x", "blue_ai_bridge"]);
    } else {
      fs.rmSync(winStartMenu(), { force: true });
      fs.rmSync(winStartup(), { force: true });
      sys("taskkill", ["/IM", "blue_ai_bridge.exe", "/F"]);
    }
    fs.rmSync(dir, { recursive: true, force: true });
    return { target: "desktop", ok: true, message: `removed the desktop app from ${dir}` };
  }
  // running from the bridge bundled inside the installed app: the app is already where it belongs
  if (bundledNode()) return { target: "desktop", ok: true, message: `the app is installed at ${path.dirname(SELF_ROOT)}` };
  const src = desktopBuild();
  if (!src)
    return {
      target: "desktop",
      ok: true,
      message: IS_WIN
        ? "skipped: no Windows build here. Install BlueAIBridge-…-windows-x64-setup.exe from the GitHub release, or run `flutter build windows --release` in desktop/"
        : "skipped: no Linux build here. Install blueaibridge_…_amd64.deb from the GitHub release, or run desktop/packaging/linux/build.sh",
    };
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.cpSync(src, dir, { recursive: true, verbatimSymlinks: true });
  if (IS_LINUX) {
    fs.chmodSync(desktopExe(), 0o755);
    fs.mkdirSync(path.dirname(linuxDesktopFile()), { recursive: true });
    fs.writeFileSync(linuxDesktopFile(), linuxDesktopEntry(false));
    fs.rmSync(legacyLinuxDesktopFile(), { force: true });
    fs.mkdirSync(path.dirname(linuxAutostartFile()), { recursive: true });
    fs.writeFileSync(linuxAutostartFile(), linuxDesktopEntry(true));
    return { target: "desktop", ok: true, message: `installed the desktop app to ${dir} (app menu entry; tray icon at login)` };
  }
  const ok = winShortcut(winStartMenu(), desktopExe(), "") && winShortcut(winStartup(), desktopExe(), "--background");
  return { target: "desktop", ok, message: ok ? `installed the desktop app to ${dir} (Start Menu; tray icon at sign-in)` : `copied the app to ${dir}, but creating the shortcuts failed` };
}

const RUNNERS: Record<Target, (a: "install" | "uninstall") => StepResult> = {
  runtime: installRuntime,
  claude: installClaude,
  codex: installCodex,
  service: installService,
  menubar: installMenubar,
  desktop: installDesktop,
};

export async function runInstall(action: "install" | "uninstall", target: Target | "all" = "all"): Promise<InstallResult> {
  backupDir = null;
  let order: Target[] = target === "all" ? [...TARGETS] : [target];
  // configs point at the runtime: install it first, remove it last
  if (action === "install" && target !== "runtime" && target !== "all" && !fs.existsSync(runtimeCli())) order = ["runtime", ...order];
  if (action === "uninstall" && target === "all") order = ["desktop", "menubar", "service", "claude", "codex", "runtime"];
  const steps: StepResult[] = [];
  for (const t of order) {
    try {
      steps.push(RUNNERS[t](action));
    } catch (e) {
      steps.push({ target: t, ok: false, message: (e as Error).message });
      if (t === "runtime" && action === "install") break; // nothing else can work without it
    }
  }
  return { ok: steps.every((s) => s.ok), action, steps, backupDir };
}

// ---------------------------------------------------------------------
// status (for the dashboard, the menu-bar app and `blueai status`)
// ---------------------------------------------------------------------

export async function installStatus() {
  const claudeSettings = (() => {
    try {
      return readJsonFile(path.join(paths.claudeDir(), "settings.json"));
    } catch {
      return {};
    }
  })();
  const claudeJson = (() => {
    try {
      return readJsonFile(paths.claudeJson());
    } catch {
      return {};
    }
  })();
  const toml = (() => {
    try {
      return fs.readFileSync(path.join(paths.codexHome(), "config.toml"), "utf8");
    } catch {
      return "";
    }
  })();
  const codexHooksCfg = (() => {
    try {
      return readJsonFile(path.join(paths.codexHome(), "hooks.json"));
    } catch {
      return {};
    }
  })();
  const runtimeVersion = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(runtimeRoot(), "package.json"), "utf8")).version as string;
    } catch {
      return null;
    }
  })();
  const claudeMcp = !!(claudeJson.mcpServers as Record<string, unknown> | undefined)?.[SERVER_NAME];
  const claudeAllowed = ((claudeSettings.permissions as { allow?: string[] })?.allow ?? []).includes(`mcp__${SERVER_NAME}`);
  const claudeHookCount = countOurHooks(claudeSettings);
  const codexMcp = toml.includes(`[mcp_servers.${CODEX_NAME}]`);
  const codexHookCount = countOurHooks(codexHooksCfg);
  const claudeCli = locateClaude();
  const codexBin = locateCodex();
  return {
    version: VERSION,
    runtime: { installed: !!runtimeVersion, version: runtimeVersion, path: runtimeRoot(), upToDate: runtimeVersion === VERSION },
    targets: [
      {
        id: "claude" as const,
        name: "Claude Code",
        installed: claudeMcp && claudeHookCount >= 6,
        partial: claudeMcp || claudeHookCount > 0,
        details: { mcp: claudeMcp, hooks: `${claudeHookCount}/7`, permission: claudeAllowed },
        clients: [
          { id: "claude-desktop", name: "Claude Desktop (Code tab)", detected: appInstalled("Claude") },
          { id: "claude-cli", name: "Claude Code CLI", detected: !!claudeCli && claudeCli.source !== "bundled", path: claudeCli?.path ?? null },
        ],
      },
      {
        id: "codex" as const,
        name: "ChatGPT / Codex",
        installed: codexMcp && codexHookCount >= 3,
        partial: codexMcp || codexHookCount > 0,
        details: { mcp: codexMcp, hooks: `${codexHookCount}/3`, toolTimeout: /tool_timeout_sec = \d+/.exec(toml)?.[0] ?? null },
        clients: [
          { id: "chatgpt-desktop", name: "ChatGPT Desktop", detected: appInstalled("ChatGPT"), path: codexBin?.source === "app" ? codexBin.path : null },
          { id: "codex-cli", name: "Codex CLI", detected: !!locateCodexStandalone(), path: locateCodexStandalone() },
        ],
      },
      {
        id: "service" as const,
        name: "Background service",
        installed: serviceInstalled(),
        partial: false,
        details: { kind: IS_MAC ? "LaunchAgent" : IS_LINUX ? "systemd --user" : IS_WIN ? "logon task" : "none" },
        clients: [],
      },
      ...(IS_MAC ? [{ id: "menubar" as const, name: "macOS app", installed: fs.existsSync(menubarDest()), partial: false, details: { app: menubarDest() }, clients: [] }] : []),
      ...(IS_WIN || IS_LINUX ? [{ id: "desktop" as const, name: "Desktop app", installed: fs.existsSync(desktopExe()), partial: false, details: { app: desktopAppDir() }, clients: [] }] : []),
    ],
  };
}
