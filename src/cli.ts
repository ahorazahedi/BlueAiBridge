#!/usr/bin/env node
// blueai — the BlueAIBridge command line.
//   blueai install [all|runtime|claude|codex|service|menubar]
//   blueai uninstall [all|…]
//   blueai status            what is installed, broker health, today's traffic
//   blueai doctor            check everything, print fixes
//   blueai ui [--web]        open the dashboard (native app on macOS, browser elsewhere)
//   blueai broker            run the broker in the foreground
//   blueai mcp --side claude|codex     (started by the apps)
//   blueai hook --app claude|codex --event <e>   (started by the apps)
//   blueai ask "<question>" [--to chatgpt|claude] [--cwd DIR]
//   blueai logs [-f]         broker log

import "./shared/quiet.js";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { paths } from "./shared/paths.js";
import { VERSION } from "./version.js";

const [cmd = "help", ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(name);
  return i === -1 ? undefined : rest[i + 1];
};
const has = (name: string) => rest.includes(name);
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: number, s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s: string) => c(32, s);
const yellow = (s: string) => c(33, s);
const red = (s: string) => c(31, s);
const dim = (s: string) => c(2, s);
const bold = (s: string) => c(1, s);

async function main() {
  switch (cmd) {
    case "mcp": {
      const { startMcp } = await import("./mcp/server.js");
      startMcp();
      return;
    }
    case "hook": {
      const { runHook } = await import("./hooks/hook.js");
      const app = flag("--app") === "codex" ? "codex" : "claude";
      const r = await runHook(app, flag("--event") ?? "");
      if (r.stdout) process.stdout.write(r.stdout);
      if (r.stderr) await new Promise<void>((res) => process.stderr.write(r.stderr, () => res()));
      process.exit(r.code);
    }
    case "broker": {
      const { startBroker } = await import("./broker/http.js");
      let h;
      try {
        h = await startBroker({ port: flag("--port") ? Number(flag("--port")) : undefined });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") {
          console.error(`[${new Date().toISOString()}] another broker already listens; exiting`);
          process.exit(launchedByService() ? 1 : 0);
        }
        throw e;
      }
      console.log(`[${new Date().toISOString()}] BlueAIBridge broker v${VERSION} on http://127.0.0.1:${h.port} (pid ${process.pid})`);
      const stop = async () => {
        await h.close();
        process.exit(0);
      };
      process.on("SIGTERM", stop);
      process.on("SIGINT", stop);
      // a broker started on demand hands over to the background service once it is installed
      if (!launchedByService()) {
        const { serviceInstalled } = await import("./install/installer.js");
        setInterval(() => {
          if (serviceInstalled()) void stop();
        }, 30_000).unref();
      }
      return;
    }
    case "install":
    case "uninstall": {
      const { runInstall, TARGETS } = await import("./install/installer.js");
      const target = (rest.find((a) => !a.startsWith("-")) ?? "all") as never;
      if (target !== "all" && !TARGETS.includes(target)) throw new Error(`unknown target ${target} (all, ${TARGETS.join(", ")})`);
      const r = await runInstall(cmd, target);
      for (const s of r.steps) console.log(`${s.ok ? green("✔") : red("✖")} ${bold(s.target.padEnd(8))} ${s.message}`);
      if (r.backupDir) console.log(dim(`backups: ${r.backupDir}`));
      if (cmd === "install" && r.ok) console.log(`\nRestart Claude Desktop and ChatGPT Desktop. Then: ${bold("blueai doctor")} and ${bold("blueai ui")}.`);
      process.exitCode = r.ok ? 0 : 1;
      return;
    }
    case "status": {
      const { installStatus } = await import("./install/installer.js");
      const { health } = await import("./broker/client.js");
      const st = await installStatus();
      const h = await health();
      console.log(bold(`BlueAIBridge v${VERSION}`));
      console.log(`runtime   ${st.runtime.installed ? green(`v${st.runtime.version}`) : yellow("not installed")}  ${dim(st.runtime.path)}`);
      console.log(`broker    ${h ? green(`running (pid ${h.pid}, port ${h.port})`) : yellow("not running")}`);
      for (const t of st.targets) {
        console.log(`${t.id.padEnd(9)} ${t.installed ? green("installed") : t.partial ? yellow("partial") : dim("not installed")}  ${dim(JSON.stringify(t.details))}`);
        for (const cl of t.clients) console.log(`            ${cl.detected ? green("●") : dim("○")} ${cl.name}`);
      }
      if (h) {
        const { call } = await import("./broker/client.js");
        const s = await call<{ messages: number; bytes: number; openLinks: number; failed: number }>("/api/summary?range=24h");
        console.log(`last 24h  ${s.messages} messages · ${(s.bytes / 1024).toFixed(1)} KB · ${s.openLinks} open links · ${s.failed} failed`);
      }
      return;
    }
    case "doctor": {
      const { runDoctor } = await import("./install/doctor.js");
      const { health } = await import("./broker/client.js");
      const r = await runDoctor({ brokerUp: !!(await health()) });
      let group = "";
      for (const ch of r.checks) {
        if (ch.group !== group) console.log("\n" + bold((group = ch.group)));
        const icon = ch.status === "ok" ? green("✔") : ch.status === "warn" ? yellow("!") : red("✖");
        console.log(`  ${icon} ${ch.name.padEnd(20)} ${ch.detail}`);
        if (ch.fix) console.log(`    ${dim("→ " + ch.fix)}`);
      }
      console.log(`\n${r.summary.ok} ok, ${r.summary.warn} warnings, ${r.summary.fail} problems`);
      process.exitCode = r.ok ? 0 : 1;
      return;
    }
    case "ui": {
      // macOS: the native app (unless --web); Windows and Linux: the web dashboard in the browser
      const { IS_MAC, openBrowser } = await import("./shared/platform.js");
      if (IS_MAC && !has("--web") && !has("--print") && fs.existsSync(paths.macApp())) {
        execFileSync("open", ["-a", paths.macApp()]);
        console.log(`Opened ${paths.macApp()}`);
        return;
      }
      const { ensureBroker } = await import("./broker/client.js");
      const { brokerToken } = await import("./broker/http.js");
      const port = await ensureBroker();
      const url = `http://127.0.0.1:${port}/auth?token=${brokerToken()}`;
      if (has("--print")) console.log(url);
      else {
        openBrowser(url);
        console.log(`Dashboard: http://127.0.0.1:${port}/`);
      }
      return;
    }
    case "ask": {
      const { call } = await import("./broker/client.js");
      const question = rest.filter((a, i) => !a.startsWith("--") && !rest[i - 1]?.startsWith("--")).join(" ");
      const to = (flag("--to") as "chatgpt" | "claude" | undefined) ?? "chatgpt";
      const caller = { app: to === "chatgpt" ? "claude" : "codex", id: `cli-${process.pid}`, cwd: flag("--cwd") ?? process.cwd(), surface: "cli" };
      const r = await call<{ text: string }>("/rpc", { body: { op: "ask", caller, args: { question, to, cwd: caller.cwd } } });
      console.log(r.text);
      return;
    }
    case "logs": {
      const file = paths.brokerLog();
      if (has("-f")) execFileSync("tail", ["-n", "100", "-f", file], { stdio: "inherit" });
      else console.log(fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").slice(-200).join("\n") : "no log yet");
      return;
    }
    case "version":
    case "--version":
      console.log(VERSION);
      return;
    default:
      console.log(`${bold("blueai")} v${VERSION} — BlueAIBridge: Claude Code ↔ ChatGPT

  blueai install [target]     install everything (or: runtime, claude, codex, service, menubar)
  blueai uninstall [target]   remove it again (backups are kept in ~/.blueaibridge/backups)
  blueai status               what is installed and running
  blueai doctor               check every piece, print fixes
  blueai ui [--web|--print]   open the dashboard (macOS: the native app; --web: browser)
  blueai ask "<question>" [--to chatgpt|claude] [--cwd DIR]
  blueai logs [-f]            broker log
  blueai broker               run the broker in the foreground`);
  }
}

/** Started by the background service (LaunchAgent, systemd unit or logon task), which restarts it on failure. */
function launchedByService() {
  return process.env.BLUE_AI_BRIDGE_SERVICE === "1" || process.env.XPC_SERVICE_NAME === "com.blueaibridge.broker";
}

main().catch((e) => {
  console.error(red(`blueai: ${(e as Error).message}`));
  process.exit(1);
});
