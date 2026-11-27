import test from "node:test";
import assert from "node:assert/strict";
import { makeRepo, commit, loadExtension, inFolder } from "./lib/fixture.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = makeRepo();
const T = (d, h = 12) => `2026-03-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00+00:00`;
commit(repo, { message: "init", date: T(2), name: "Ada Lovelace", files: { "a.txt": "1\n2\n3\n" } });
commit(repo, { message: "add feature", date: T(3, 23), name: "Ada Lovelace", files: { "a.txt": "1\n2\n3\n4\n5\n" } });
commit(repo, { message: "Revert \"add feature\"", date: T(4), name: "Grace Hopper", files: { "a.txt": "1\n2\n3\n" } });
commit(repo, { message: "<b>bold</b> \"quoted\"", date: T(5), name: "Grace Hopper", files: { "b.txt": "x\n" } });

process.env.STUB_WORKSPACE = repo;
const ext = await loadExtension("plugins/mb-commit-constellations/com.github.copilot/extensions/mb-commit-constellations/extension.mjs");
const canvas = ext.canvases.find((c) => c.id === "commit-constellations");
const act = (name, input = {}) => canvas.actions.find((a) => a.name === name).handler({ input, instanceId: "t" });

test("parseLog reads records, shortstat and reverts", () => {
  const out = "\x1eabcdef0123456789\x1fAda\x1f2026-03-02T12:00:00+00:00\x1fRevert \"x\"\n\n 1 file changed, 3 insertions(+), 1 deletion(-)\n";
  const [c] = ext.mod.parseLog(out);
  assert.deepEqual([c.h, c.a, c.i, c.x, c.r], ["abcdef0123", "Ada", 3, 1, true]);
});

test("constellation names are stable and well formed", () => {
  const n = ext.mod.constellationName("Ada Lovelace");
  assert.equal(n, ext.mod.constellationName("Ada Lovelace"));
  assert.match(n, /Ada/);
});

const mk = (over) => Array.from({ length: over.n ?? 10 }, (_, k) => ({ d: over.d?.(k) ?? "2026-03-04T12:00:00+00:00", i: over.i ?? 10, x: over.x ?? 5, r: over.r?.(k) ?? false, s: over.s ?? "a longer commit subject" }));
test("epithet rules", () => {
  const e = ext.mod.epithet;
  assert.equal(e("a", mk({ r: (k) => k < 3 })), "the Time Traveller");
  assert.equal(e("a", mk({ d: () => "2026-03-04T23:30:00+00:00" })), "the Midnight Committer");
  assert.equal(e("a", mk({ d: () => "2026-03-06T16:00:00+00:00" })), "the Friday Deployer"); // Fri
  assert.equal(e("a", mk({ d: () => "2026-03-07T12:00:00+00:00" })), "the Weekend Warrior"); // Sat
  assert.equal(e("a", mk({ i: 0, x: 100 })), "the Great Deleter");
  assert.equal(e("a", mk({ i: 500, x: 0 })), "the Monolith Builder");
  assert.equal(e("a", mk({ i: 1, x: 1 })), "the Typo Hunter");
  assert.equal(e("a", mk({ s: "short" })), "of Few Words");
  assert.match(e("a", mk({})), /Steady Hand|Quiet Maintainer|Reliable Orbit/);
});

test("sky_report reads the fixture repo", async () => {
  const r = await act("sky_report");
  assert.equal(r.stars, 4);
  assert.equal(r.shootingStars, 1);
  assert.deepEqual(r.constellations.map((c) => c.name).sort(), ["Ada Lovelace", "Grace Hopper"]);
});

test("refresh honours maxCommits", async () => {
  assert.equal((await act("refresh", { maxCommits: 2 })).stars, 2);
  assert.equal((await act("refresh")).stars, 4);
});

test("server: token required, data is literal JSON, highlight and SSE work", async () => {
  const { url } = await canvas.open({ instanceId: "s1" });
  const base = new URL(url);
  const at = (p, search = base.search) => `${base.origin}${p}${search}`;
  assert.equal(base.hostname, "127.0.0.1");
  assert.equal((await fetch(`${base.origin}/data`)).status, 403);
  assert.equal((await fetch(at("/data", "?t=wrong"))).status, 403);
  const data = await (await fetch(at("/data"))).json();
  assert.ok(data.commits.some((c) => c.s === "<b>bold</b> \"quoted\""));
  const page = await (await fetch(at("/"))).text();
  assert.ok(!/innerHTML/.test(page));

  const ctrl = new AbortController();
  const res = await fetch(at("/events"), { signal: ctrl.signal });
  const reader = res.body.getReader();
  await reader.read(); // ": connected"
  const next = reader.read();
  assert.deepEqual(await act("highlight_author", { author: "Grace" }), { highlight: "Grace" });
  const chunk = new TextDecoder().decode((await next).value);
  assert.match(chunk, /"type":"highlight"/);
  assert.equal((await (await fetch(at("/data"))).json()).highlight, "Grace");
  await act("highlight_author", { author: "" });
  ctrl.abort();

  const bad = await fetch(at("/ask"), { method: "POST", body: JSON.stringify({ hash: "nope; rm" }) });
  assert.equal(bad.status, 400);
  const big = await fetch(at("/ask"), { method: "POST", body: "x".repeat(5000) });
  assert.equal(big.status, 413);
  const sha = data.commits[0].h;
  assert.equal((await fetch(at("/ask"), { method: "POST", body: JSON.stringify({ hash: sha }) })).status, 202);
  assert.match(ext.session.sent.at(-1).prompt, new RegExp(sha));

  await canvas.onClose({ instanceId: "s1" });
  await assert.rejects(fetch(at("/data")));
});

test("non-git folder gives an error naming the folders tried and git's stderr", async () => {
  const empty = mkdtempSync(join(tmpdir(), "nogit-"));
  ext.session.workspacePath = empty;
  try {
    const r = await inFolder(empty, () => act("refresh"));
    assert.match(r.error, /no git repository found/);
    assert.ok(r.error.includes(empty));
    assert.match(r.error, /not a git repository/i); // git's own stderr
    assert.equal(r.stars, 0);
  } finally {
    ext.session.workspacePath = repo;
  }
});

test("finds the repo via cwd when workspacePath is the session folder, not the repo", async () => {
  const sessionDir = mkdtempSync(join(tmpdir(), "session-state-"));
  const home = process.cwd();
  process.chdir(repo);
  ext.session.workspacePath = sessionDir;
  try {
    const r = await act("refresh");
    assert.equal(r.error, undefined);
    assert.equal(r.stars, 4);
  } finally {
    process.chdir(home);
    ext.session.workspacePath = repo;
  }
});

test("falls back to workspacePath when cwd is not a repo", async () => {
  const elsewhere = mkdtempSync(join(tmpdir(), "elsewhere-"));
  const home = process.cwd();
  process.chdir(elsewhere);
  try {
    const r = await act("refresh");
    assert.equal(r.error, undefined);
    assert.equal(r.stars, 4);
  } finally {
    process.chdir(home);
  }
});

test("page script has no template literals (String.raw safety)", async () => {
  const { url } = await canvas.open({ instanceId: "s2" });
  const html = await (await fetch(url)).text();
  const script = html.slice(html.indexOf("<script>"), html.indexOf("</script>"));
  assert.ok(!script.includes("`") && !script.includes("${"));
  await canvas.onClose({ instanceId: "s2" });
});
