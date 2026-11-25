// OS-specific lookups: the apps' bundled CLIs, whether ChatGPT Desktop runs,
// and opening deep links. Every lookup has an env override for odd installs.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { HOME } from "./paths.js";

/** The OS this runs on (BLUE_AI_BRIDGE_PLATFORM overrides it, for tests of other platforms' installers). */
export const PLATFORM = (process.env.BLUE_AI_BRIDGE_PLATFORM as NodeJS.Platform | undefined) ?? process.platform;
export const IS_MAC = PLATFORM === "darwin";
export const IS_WIN = PLATFORM === "win32";
export const IS_LINUX = PLATFORM === "linux";

function onPath(name: string): string | null {
  const exts = IS_WIN ? (process.env.PATHEXT || ".EXE;.CMD").split(";").map((e) => e.toLowerCase()) : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      if (dir && fs.existsSync(p)) return p;
    }
  }
  return null;
}

function newestIn(root: string, depth: number, file: string): string | null {
  let dirs = [root];
  for (let i = 0; i < depth; i++) {
    dirs = dirs.flatMap((d) => {
      try {
        return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(d, e.name));
      } catch {
        return [];
      }
    });
  }
  const hits = dirs.map((d) => path.join(d, file)).filter((p) => fs.existsSync(p));
  hits.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return hits[0] ?? null;
}

export const appDirs = () => ["/Applications", path.join(HOME(), "Applications")];

export interface Located {
  path: string;
  source: "override" | "app" | "path" | "bundled";
}

/** Codex CLI: the copy bundled in ChatGPT.app first (it shares the app's threads and queue). */
export function locateCodex(): Located | null {
  if (process.env.BLUE_AI_BRIDGE_CODEX_BIN) return { path: process.env.BLUE_AI_BRIDGE_CODEX_BIN, source: "override" };
  if (IS_MAC) {
    for (const dir of appDirs()) {
      for (const app of ["ChatGPT.app", "Codex.app"]) {
        const res = path.join(dir, app, "Contents", "Resources");
        const cands = [path.join(res, "codex-cli", "bin", "codex"), path.join(res, "codex")];
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(res, "codex-cli", "codex-package.json"), "utf8"));
          if (typeof pkg.entrypoint === "string") cands.unshift(path.join(res, "codex-cli", pkg.entrypoint));
        } catch {
          /* older layout */
        }
        const hit = cands.find((c) => fs.existsSync(c));
        if (hit) return { path: hit, source: "app" };
      }
    }
  }
  if (IS_WIN) {
    const local = process.env.LOCALAPPDATA || path.join(HOME(), "AppData", "Local");
    const hit = newestIn(path.join(local, "OpenAI", "Codex", "bin"), 1, "codex.exe");
    if (hit) return { path: hit, source: "app" };
  }
  const p = onPath("codex");
  return p ? { path: p, source: "path" } : null;
}

/** Codex CLI installed on its own (terminal use), not the app's bundled copy. */
export function locateCodexStandalone(): string | null {
  return onPath("codex");
}

/** Claude Code CLI: on PATH, ~/.local/bin, or the copy bundled with Claude Desktop. */
export function locateClaude(): Located | null {
  if (process.env.BLUE_AI_BRIDGE_CLAUDE_BIN) return { path: process.env.BLUE_AI_BRIDGE_CLAUDE_BIN, source: "override" };
  const p = onPath("claude");
  if (p) return { path: p, source: "path" };
  const local = path.join(HOME(), ".local", "bin", "claude");
  if (fs.existsSync(local)) return { path: local, source: "path" };
  if (IS_MAC) {
    const hit = newestIn(path.join(HOME(), "Library", "Application Support", "Claude", "claude-code"), 2, path.join("claude.app", "Contents", "MacOS", "claude"));
    if (hit) return { path: hit, source: "bundled" };
  }
  if (IS_WIN) {
    const appData = process.env.APPDATA || path.join(HOME(), "AppData", "Roaming");
    const hit = newestIn(path.join(appData, "Claude", "claude-code"), 2, "claude.exe");
    if (hit) return { path: hit, source: "bundled" };
  }
  return null;
}

export function appInstalled(name: "ChatGPT" | "Claude"): boolean {
  if (process.env.BLUE_AI_BRIDGE_FAKE_APPS) return process.env.BLUE_AI_BRIDGE_FAKE_APPS.split(",").includes(name);
  if (IS_MAC) return appDirs().some((d) => fs.existsSync(path.join(d, `${name}.app`)));
  if (IS_WIN) {
    const local = process.env.LOCALAPPDATA || path.join(HOME(), "AppData", "Local");
    if (name === "Claude") return fs.existsSync(path.join(local, "AnthropicClaude")) || fs.existsSync(path.join(local, "Programs", "Claude"));
    // ChatGPT Desktop on Windows ships its codex CLI under %LOCALAPPDATA%\OpenAI\Codex
    return fs.existsSync(path.join(local, "OpenAI", "Codex")) || fs.existsSync(path.join(local, "Programs", "ChatGPT"));
  }
  return false; // neither desktop app exists for Linux: the CLIs and headless delivery are used there
}

const RUNNING_RE = /\/(ChatGPT|Codex)\.app\/Contents\/MacOS\/(ChatGPT|Codex)(\s|$)/m;

/** Whether ChatGPT Desktop runs: true / false, or null when the check failed. */
export function chatgptRunning(): Promise<boolean | null> {
  const fake = process.env.BLUE_AI_BRIDGE_FAKE_CHATGPT_RUNNING;
  if (fake !== undefined) return Promise.resolve(fake === "1" ? true : fake === "0" ? false : null);
  if (IS_MAC)
    return new Promise((resolve) =>
      execFile("ps", ["-axo", "command="], { encoding: "utf8", maxBuffer: 32 << 20, timeout: 10_000 }, (err, out) => resolve(err ? null : RUNNING_RE.test(out))),
    );
  if (IS_WIN)
    return new Promise((resolve) =>
      execFile(
        "powershell.exe",
        ["-NoProfile", "-Command", "@(Get-Process -Name ChatGPT,Codex -ErrorAction SilentlyContinue | Where-Object { $_.Path -notmatch '\\\\OpenAI\\\\Codex\\\\bin\\\\' }).Count"],
        { encoding: "utf8", timeout: 10_000, windowsHide: true },
        (err, out) => resolve(err ? null : Number(String(out).trim()) > 0),
      ),
    );
  return Promise.resolve(null);
}

/** Open a web page in the user's browser. */
export function openBrowser(url: string) {
  if (IS_MAC) execFileSync("open", [url], { stdio: "ignore" });
  else if (IS_WIN) execFileSync("cmd.exe", ["/d", "/c", "start", "", url], { stdio: "ignore" });
  else execFileSync("xdg-open", [url], { stdio: "ignore" });
}

/** Hand a URL (codex://…, claude://…) to the OS, without bringing the app to the front on macOS. */
export function openUrl(url: string) {
  if (process.env.BLUE_AI_BRIDGE_FAKE_OPEN) {
    if (process.env.BLUE_AI_BRIDGE_FAKE_OPEN === "fail") throw new Error("cannot open (test)");
    fs.appendFileSync(path.join(os.tmpdir(), "blueai-opened.log"), url + "\n");
    return;
  }
  if (IS_MAC) execFileSync("open", ["-g", url], { stdio: "ignore" });
  else if (IS_WIN) execFileSync("cmd.exe", ["/d", "/c", "start", "", url], { stdio: "ignore" });
  else execFileSync("xdg-open", [url], { stdio: "ignore" });
}

export function openChatgpt() {
  if (process.env.BLUE_AI_BRIDGE_FAKE_OPEN) return openUrl("codex://");
  if (IS_MAC) execFileSync("open", ["-g", "-b", "com.openai.codex"], { stdio: "ignore" });
  else openUrl("codex://");
}

export const claudeSessionUrl = (hostId: string) => `claude://code/continue?session=${encodeURIComponent(hostId)}`;

/**
 * Environment for a child agent CLI: without the parent session's identity
 * (a child `claude -p` must not think it is the calling session) and marked
 * as a bridge child, so it never asks back (no ping-pong).
 */
export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(CLAUDECODE|CLAUDE_CODE_SESSION_ID|CLAUDE_CODE_HOST_SESSION_ID|CLAUDE_CODE_MESSAGING_.*|CLAUDE_CODE_CHILD_.*|CLAUDE_PID|CLAUDE_CODE_SESSION_ATTENDED|CLAUDE_CODE_ENTRYPOINT|CODEX_THREAD_ID|CODEX_SESSION_ID)$/.test(k)) continue;
    env[k] = v;
  }
  return { ...env, BLUE_AI_BRIDGE_CHILD: "1", ...extra };
}
