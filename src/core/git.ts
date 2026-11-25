// Git and file-system views of the work: what a reviewer is told to read,
// fingerprints (what an approval covers), and turn snapshots. Nothing here
// touches the user's index, refs or files: snapshots use a temporary index.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GIT_SECRET_EXCLUDES, isSecretPath } from "../shared/secrets.js";
import { run, sha256 } from "../shared/util.js";

const GIT_TIMEOUT = 15_000;
const MAX_WALK_FILES = 20_000;
const DIFF_CAP = 60_000;

async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv, timeoutMs = GIT_TIMEOUT) {
  const r = await run("git", args, { cwd, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C", ...env }, timeoutMs });
  return r;
}

export interface RepoInfo {
  root: string;
  /** path inside the repo, relative ("" for the whole repo) */
  rel: string;
  head: string | null;
  branch: string | null;
}

export async function repoOf(p: string): Promise<RepoInfo | null> {
  const abs = path.resolve(p);
  const dir = fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
  if (!fs.existsSync(dir)) return null;
  const top = await git(dir, ["rev-parse", "--show-toplevel"]).catch(() => null);
  if (!top || top.code !== 0) return null;
  const root = fs.realpathSync(top.stdout.trim());
  const rel = path.relative(root, fs.existsSync(abs) ? fs.realpathSync(abs) : abs).split(path.sep).join("/");
  const head = await git(root, ["rev-parse", "--verify", "-q", "HEAD"]);
  const br = await git(root, ["symbolic-ref", "--short", "-q", "HEAD"]);
  return { root, rel, head: head.code === 0 ? head.stdout.trim() : null, branch: br.code === 0 ? br.stdout.trim() : null };
}

const q = (s: string) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
const specs = (rel: string) => [rel || ".", ...GIT_SECRET_EXCLUDES];

/** Files in a path: git-visible ones (tracked + untracked, not ignored), or a walk outside git. Secrets left out. */
export async function listFiles(p: string): Promise<{ base: string; files: string[]; truncated: boolean; repo: RepoInfo | null }> {
  const repo = await repoOf(p);
  if (repo) {
    const r = await git(repo.root, ["ls-files", "-z", "-co", "--exclude-standard", "--", ...specs(repo.rel)]);
    const files = r.stdout.split("\0").filter((f) => f && !isSecretPath(f));
    return { base: repo.root, files, truncated: false, repo };
  }
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) return { base: abs, files: [], truncated: false, repo: null };
  if (fs.statSync(abs).isFile()) return { base: path.dirname(abs), files: isSecretPath(abs) ? [] : [path.basename(abs)], truncated: false, repo: null };
  const files: string[] = [];
  let truncated = false;
  const walk = (dir: string, rel: string) => {
    if (files.length >= MAX_WALK_FILES) return void (truncated = true);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git" || isSecretPath(r + "/x")) continue;
        walk(path.join(dir, e.name), r);
      } else if (e.isFile() && !isSecretPath(r)) files.push(r);
      if (files.length >= MAX_WALK_FILES) return void (truncated = true);
    }
  };
  walk(abs, "");
  return { base: abs, files, truncated, repo: null };
}

/**
 * A fingerprint of a path's content: changes when any visible file's content,
 * name or presence changes. Committing does not change it.
 */
export async function fingerprint(p: string): Promise<string> {
  const { base, files, repo } = await listFiles(p);
  if (!files.length) return sha256(`empty:${path.resolve(p)}`);
  files.sort();
  let hashes: string[];
  if (repo) {
    const input = files.join("\n") + "\n";
    const out = await run("git", ["hash-object", "--stdin-paths", "--no-filters"], { cwd: base, input, timeoutMs: 30_000 });
    hashes = out.stdout.split("\n").filter(Boolean);
    if (hashes.length !== files.length) {
      // a file vanished between listing and hashing: hash one by one
      hashes = files.map((f) => fileHash(path.join(base, f)));
    }
  } else hashes = files.map((f) => fileHash(path.join(base, f)));
  return sha256(files.map((f, i) => `${f}\0${hashes[i]}`).join("\n"));
}

function fileHash(f: string): string {
  try {
    const st = fs.lstatSync(f);
    if (st.isSymbolicLink()) return "link:" + fs.readlinkSync(f);
    return sha256(fs.readFileSync(f));
  } catch {
    return "unreadable";
  }
}

/**
 * Snapshot a repo's working tree as a git tree object, through a temporary
 * index (copy of the real one), so the user's index and refs are untouched.
 */
export async function snapshot(p: string): Promise<{ root: string; tree: string } | null> {
  const repo = await repoOf(p);
  if (!repo) return null;
  const gitDir = (await git(repo.root, ["rev-parse", "--git-dir"])).stdout.trim();
  const realIndex = path.resolve(repo.root, gitDir, "index");
  const tmpIndex = path.join(os.tmpdir(), `blueai-index-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    if (fs.existsSync(realIndex)) fs.copyFileSync(realIndex, tmpIndex);
    const env = { GIT_INDEX_FILE: tmpIndex };
    const add = await git(repo.root, ["add", "-A", "--", ...specs("")], env, 20_000);
    if (add.code !== 0) return null;
    const tree = await git(repo.root, ["write-tree"], env);
    return tree.code === 0 ? { root: repo.root, tree: tree.stdout.trim() } : null;
  } finally {
    fs.rmSync(tmpIndex, { force: true });
  }
}

export interface PathSummary {
  path: string;
  exists: boolean;
  git: boolean;
  root: string | null;
  branch: string | null;
  head: string | null;
  status: string;
  stat: string;
  commands: string[];
  diff?: string;
}

/** What a reviewer is told about a path: a short status, a stat, and ready read-only commands. */
export async function summarize(p: string, opts: { includeDiff?: boolean; since?: { tree?: string; commit?: string } } = {}): Promise<PathSummary> {
  const abs = path.resolve(p);
  const exists = fs.existsSync(abs);
  const repo = exists ? await repoOf(abs) : null;
  if (!repo) {
    const { files, truncated } = exists ? await listFiles(abs) : { files: [], truncated: false };
    const recent = files
      .map((f) => {
        const full = fs.statSync(abs).isFile() ? abs : path.join(abs, f);
        try {
          return { f, m: fs.statSync(full).mtimeMs };
        } catch {
          return { f, m: 0 };
        }
      })
      .sort((a, b) => b.m - a.m)
      .slice(0, 25);
    return {
      path: abs,
      exists,
      git: false,
      root: null,
      branch: null,
      head: null,
      status: exists ? `not a git repository; ${files.length}${truncated ? "+" : ""} files` : "does not exist (deleted?)",
      stat: recent.map((r) => `${new Date(r.m).toISOString().slice(0, 16)}  ${r.f}`).join("\n"),
      commands: exists ? [`ls -la ${q(abs)}`, "Read the files directly; most recently modified first (listed above)."] : [],
    };
  }
  const base = opts.since?.tree ?? opts.since?.commit ?? (repo.head ? "HEAD" : null);
  const ps = specs(repo.rel);
  const st = await git(repo.root, ["status", "--short", "--untracked-files=all", "--", ...ps]);
  const statusLines = st.stdout.trim().split("\n").filter(Boolean);
  let stat = "";
  if (base) {
    const ds = await git(repo.root, ["diff", "--stat=120", base, "--", ...ps]);
    stat = ds.stdout.trim();
  }
  const untracked = statusLines.filter((l) => l.startsWith("??")).map((l) => l.slice(3));
  const C = `git -C ${q(repo.root)}`;
  // secret files are left out of the pathspec the reviewer runs too
  const pathspec = [q(repo.rel || "."), ...GIT_SECRET_EXCLUDES.map(q)].join(" ");
  const commands = [
    base ? `${C} diff ${base === "HEAD" ? "HEAD" : base} -- ${pathspec}` : `${C} diff --cached -- ${pathspec}`,
    `${C} status --short --untracked-files=all -- ${pathspec}`,
  ];
  if (untracked.length) commands.push(`Untracked files (read them directly): ${untracked.slice(0, 20).join(", ")}${untracked.length > 20 ? ` (+${untracked.length - 20} more)` : ""}`);
  const summary: PathSummary = {
    path: abs,
    exists: true,
    git: true,
    root: repo.root,
    branch: repo.branch,
    head: repo.head,
    status: `${repo.branch ?? "detached"} @ ${repo.head?.slice(0, 10) ?? "no commits"} · ${statusLines.length} changed or untracked`,
    stat: stat || (statusLines.length ? statusLines.slice(0, 40).join("\n") : "no changes"),
    commands,
  };
  if (opts.includeDiff && base) {
    const d = await git(repo.root, ["diff", base, "--", ...ps], undefined, 30_000);
    summary.diff = d.stdout.length > DIFF_CAP ? d.stdout.slice(0, DIFF_CAP) + `\n… diff cut at ${DIFF_CAP} characters` : d.stdout;
  }
  return summary;
}

/** Stat + command for what changed in a repo between two snapshots (a turn). */
export async function turnChanges(root: string, from: string, to: string, rel = ""): Promise<{ stat: string; command: string }> {
  const ps = specs(rel);
  const d = await git(root, ["diff", "--stat=120", from, to, "--", ...ps]);
  return { stat: d.stdout.trim() || "no changes in this turn", command: `git -C ${q(root)} diff ${from.slice(0, 12)} ${to.slice(0, 12)} -- ${q(rel || ".")}` };
}

export function renderSummaries(list: PathSummary[]): string {
  return list
    .map((s) => {
      const parts = [`### ${s.path}`, `Status: ${s.status}`];
      if (s.stat) parts.push("```\n" + s.stat + "\n```");
      // commands in code spans: copyable as-is, and pathspecs like **/.env* are never read as markdown
      if (s.commands.length) parts.push("Read the changes with:\n" + s.commands.map((c) => (/^(git|ls) /.test(c) ? `- \`${c}\`` : `- ${c}`)).join("\n"));
      if (s.diff) parts.push("Diff:\n```diff\n" + s.diff + "\n```");
      return parts.join("\n");
    })
    .join("\n\n");
}
