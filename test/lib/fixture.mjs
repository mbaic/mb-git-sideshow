// Test helpers: build git fixture repos in a temp folder with fixed dates.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { register } from "node:module";

let registered = false;
/** Make "@github/copilot-sdk/extension" resolve to the stub, once per process. */
export async function loadExtension(path) {
  if (!registered) { register("../stub/hooks.mjs", import.meta.url); registered = true; }
  const stub = await import("../stub/sdk-extension.mjs");
  const mod = await import(new URL(`../../${path}`, import.meta.url).href);
  return { stub, mod, canvases: stub.captured.canvases, session: stub.captured.session };
}

export function git(cwd, args, env = {}) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
}

export function makeRepo({ branch = "main", name = "repo" } = {}) {
  const dir = join(mkdtempSync(join(tmpdir(), "sideshow-")), name);
  mkdirSync(dir);
  git(dir, ["init", "-q", "-b", branch]);
  git(dir, ["config", "user.name", "Test User"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  return dir;
}

/** Commit with a fixed author/committer date. `files` maps path -> content. */
export function commit(dir, { message, date, name = "Test User", email = "test@example.com", files, committerDate = date }) {
  for (const [path, content] of Object.entries(files ?? { [`f-${Math.random().toString(36).slice(2)}.txt`]: message })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "--allow-empty", "-m", message], {
    GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email, GIT_COMMITTER_DATE: committerDate,
  });
  return git(dir, ["rev-parse", "HEAD"]).trim();
}

/** Runs fn with process.cwd() set to dir and INIT_CWD/PWD cleared, so folder probing is deterministic. */
export async function inFolder(dir, fn) {
  const home = process.cwd();
  const saved = { INIT_CWD: process.env.INIT_CWD, PWD: process.env.PWD };
  delete process.env.INIT_CWD; delete process.env.PWD;
  process.chdir(dir);
  try { return await fn(); } finally {
    process.chdir(home);
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
}
