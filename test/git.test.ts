import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { setupEnv, makeRepo } from "./helpers.js";
const { root } = setupEnv();
const G = await import("../src/core/git.js");

test("fingerprint follows content, not commits, and ignores secrets", async () => {
  const { dir, git } = makeRepo(root, "fp");
  const f0 = await G.fingerprint(dir);
  fs.writeFileSync(path.join(dir, "a.js"), "let a = 2;\n");
  const f1 = await G.fingerprint(dir);
  assert.notEqual(f0, f1);
  git("add", ".");
  git("commit", "-qm", "c");
  assert.equal(await G.fingerprint(dir), f1, "committing doesn't change the fingerprint");
  fs.writeFileSync(path.join(dir, ".env"), "SECRET=1\n");
  assert.equal(await G.fingerprint(dir), f1, "secret files are left out");
  fs.writeFileSync(path.join(dir, "new.js"), "x\n");
  assert.notEqual(await G.fingerprint(dir), f1, "untracked files count");
});

test("fingerprint outside git walks files and skips node_modules", async () => {
  const dir = path.join(root, "plain");
  fs.mkdirSync(path.join(dir, "node_modules", "x"), { recursive: true });
  fs.writeFileSync(path.join(dir, "a.txt"), "1");
  const f0 = await G.fingerprint(dir);
  fs.writeFileSync(path.join(dir, "node_modules", "x", "i.js"), "1");
  assert.equal(await G.fingerprint(dir), f0);
  fs.writeFileSync(path.join(dir, "a.txt"), "2");
  assert.notEqual(await G.fingerprint(dir), f0);
});

test("snapshots leave the user's index untouched and diff a turn", async () => {
  const { dir } = makeRepo(root, "snap");
  fs.writeFileSync(path.join(dir, "staged.js"), "s\n");
  execFileSync("git", ["add", "staged.js"], { cwd: dir });
  const statusBefore = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
  const a = await G.snapshot(dir);
  fs.writeFileSync(path.join(dir, "a.js"), "let a = 3;\nlet b = 4;\n");
  fs.writeFileSync(path.join(dir, "fresh.js"), "f\n");
  const b = await G.snapshot(dir);
  assert.ok(a && b && a.tree !== b.tree);
  const after = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
  assert.match(after, /^A  staged\.js/m, "the index still has only what the user staged");
  assert.ok(!/^A  fresh\.js/m.test(after));
  assert.notEqual(statusBefore, after);
  const ch = await G.turnChanges(a!.root, a!.tree, b!.tree);
  assert.match(ch.stat, /a\.js/);
  assert.match(ch.stat, /fresh\.js/);
  assert.match(ch.command, /git -C .* diff [0-9a-f]{12} [0-9a-f]{12}/);
});

test("summaries give status, stat and read-only commands", async () => {
  const { dir } = makeRepo(root, "sum");
  fs.writeFileSync(path.join(dir, "a.js"), "changed\n");
  fs.writeFileSync(path.join(dir, "u.js"), "untracked\n");
  const s = await G.summarize(dir, { includeDiff: true });
  assert.equal(s.git, true);
  assert.match(s.status, /2 changed or untracked/);
  assert.match(s.stat, /a\.js/);
  assert.ok(s.commands.some((c) => /diff HEAD/.test(c) && /exclude/.test(c)));
  assert.ok(s.commands.some((c) => /u\.js/.test(c)));
  assert.match(s.diff!, /\+changed/);
  const none = await G.summarize(path.join(root, "missing"));
  assert.equal(none.exists, false);
  const rendered = G.renderSummaries([s]);
  assert.match(rendered, /Read the changes with/);
});
