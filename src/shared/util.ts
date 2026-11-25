import crypto from "node:crypto";
import { spawn } from "node:child_process";

export const now = () => Date.now();
export const bytesOf = (s: string) => Buffer.byteLength(s, "utf8");
export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString("hex");
export const sha256 = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex");
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A 6-character join code without look-alike characters. */
export function joinCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const buf = crypto.randomBytes(6);
  return Array.from(buf, (b) => alphabet[b % alphabet.length]).join("");
}

export function truncate(s: string, max: number, marker = "…"): string {
  return s.length <= max ? s : s.slice(0, Math.max(0, max - marker.length)) + marker;
}

export function oneLine(s: string, max = 120): string {
  return truncate(s.replace(/\s+/g, " ").trim(), max);
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Run a process to completion with a time limit. Never throws for a non-zero exit. */
export function run(
  bin: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number; maxBuffer?: number } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ["pipe", "pipe", "pipe"] });
    const max = opts.maxBuffer ?? 64 << 20;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (d) => {
      if (stdout.length < max) stdout += d;
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < max) stderr += d;
    });
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), 3000).unref();
        }, opts.timeoutMs)
      : null;
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(opts.input ?? "");
  });
}

export const lastLines = (s: string, n = 5) => s.trim().split("\n").slice(-n).join(" ").trim();
