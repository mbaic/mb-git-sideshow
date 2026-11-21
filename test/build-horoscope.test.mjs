import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRepo, commit, git, loadExtension } from "./lib/fixture.mjs";

// Spec section 10 fixture: main with 8 commits; feature forked 3 commits back with 2 own commits,
// one stash and one untracked file.
const D = (d) => `2026-03-${String(d).padStart(2, "0")}T12:00:00+00:00`;
const repo = makeRepo();
for (let i = 1; i <= 5; i++) commit(repo, { message: `main ${i}`, date: D(i), files: { [`m${i}.txt`]: "x\n" } });
git(repo, ["checkout", "-q", "-b", "feature"]);
commit(repo, { message: "wip", date: D(6), files: { "hot.txt": "1\n" } });
commit(repo, { message: "feature two", date: D(7), files: { "hot.txt": "2\n" } });
git(repo, ["checkout", "-q", "main"]);
for (let i = 6; i <= 8; i++) commit(repo, { message: `main ${i}`, date: D(i + 2), files: { [`m${i}.txt`]: "x\n" } });
git(repo, ["checkout", "-q", "feature"]);
writeFileSync(join(repo, "m1.txt"), "changed\n");
git(repo, ["stash", "push", "-q", "-m", "s"]);
writeFileSync(join(repo, "untracked.txt"), "u\n");

process.env.STUB_WORKSPACE = repo;
const ext = await loadExtension("plugins/build-horoscope/com.github.copilot/extensions/build-horoscope/extension.mjs");
const canvas = ext.canvases.find((c) => c.id === "build-horoscope");
const act = (name, input = {}) => canvas.actions.find((a) => a.name === name).handler({ input, instanceId: "t" });
const NOW = new Date("2026-03-20T12:00:00+00:00");

test("signal reader matches the spec fixture", async () => {
  const r = await ext.mod.readSigns({ now: NOW });
  assert.equal(r.base, "main"); // falls back to local main with no remote
  assert.equal(r.signals.behind, 3);
  assert.equal(r.signals.ahead, 2);
  assert.equal(r.signals.stashes, 1);
  assert.equal(r.signals.dirty, 1);
  assert.equal(r.signals.todoFiles, 0);
  assert.equal(r.signals.lazy, 1); // "wip"
  assert.equal(r.signals.luckyFile, "hot.txt");
  assert.equal(r.signals.syncDays, 15); // merge-base = main 5 on 2026-03-05
  assert.equal(r.signals.branchAgeDays, 14);
});

test("zodiac sign comes from the birth month", () => {
  assert.equal(ext.mod.signFor("2026-03-06T12:00:00+00:00").name, "The Hotfix");
  assert.equal(ext.mod.signFor("2026-12-31T23:59:00-05:00").name, "The Legacy");
  assert.equal(ext.mod.signFor("garbage").name, "A Wandering Star");
});

test("instant reading: most severe first, max three, aligned fallback", () => {
  const quiet = { behind: 0, ahead: 0, syncDays: 0, idleDays: 0, dirty: 0, stashes: 0, todoFiles: 0, lazy: 0, luckyFile: "" };
  assert.match(ext.mod.instantReading(quiet, "main", false).sentences[0], /aligned/);
  const noisy = { ...quiet, behind: 40, syncDays: 15, stashes: 4, dirty: 11, ahead: 5 };
  const r = ext.mod.instantReading(noisy, "main", false);
  assert.equal(r.sentences.length, 3);
  assert.match(r.sentences[0], /Mercury is in retrograde and so is your branch: 40 commits behind main/);
  assert.equal(r.avoidToday, "force-pushing");
  assert.equal(r.luckyNumber, 5);
});

test("thresholds are exclusive and mercury/saturn vanish on trunk", () => {
  const s = { behind: 20, dirty: 10, stashes: 3, syncDays: 14, idleDays: 7, ahead: 40, lazy: 2, todoFiles: 25 };
  assert.equal(ext.mod.planetStates(s, false).some((p) => p.over), false);
  assert.deepEqual(ext.mod.planetStates(s, true).map((p) => p.key), ["venus", "pluto", "moon"]);
});

test("read_signs and chart for another branch; compatibility", async () => {
  const r = await act("read_signs");
  assert.equal(r.branch, "feature");
  assert.equal(r.sign.name, "The Hotfix");
  assert.equal(r.compat.most.branch, "main");
  const main = await act("read_signs", { branch: "main" });
  assert.equal(main.trunk, true);
  assert.equal(main.sign.name, "The North Star");
  assert.equal(main.signals.dirty, 0); // working tree belongs to feature
  assert.equal((await act("read_signs", { branch: "nope; rm -rf" })).error.includes("no local branch"), true);
});

test("detached HEAD reads as a wandering star", async () => {
  const dir = makeRepo();
  commit(dir, { message: "a", date: D(1) });
  const sha = commit(dir, { message: "b", date: D(2) });
  git(dir, ["checkout", "-q", "--detach", sha]);
  ext.session.workspacePath = dir;
  const r = await act("read_signs");
  assert.equal(r.branch, "a wandering star");
  ext.session.workspacePath = repo;
});

test("non-git folder gives a friendly error", async () => {
  ext.session.workspacePath = mkdtempSync(join(tmpdir(), "nogit-"));
  assert.match((await act("read_signs")).error, /not a git repository/);
  ext.session.workspacePath = repo;
});

test("server: token, deliver_reading, SSE, refresh sends the skill prompt", async () => {
  const { url } = await canvas.open({ instanceId: "s1" });
  const base = new URL(url);
  const at = (p, extra = "") => `${base.origin}${p}${base.search}${extra}`;
  assert.equal((await fetch(`${base.origin}/signs`)).status, 403);
  const chart = await (await fetch(at("/signs"))).json();
  assert.equal(chart.branch, "feature");
  assert.equal(chart.reading, null);
  assert.equal((await (await fetch(at("/signs", "&branch=main"))).json()).trunk, true);
  assert.ok(!/innerHTML/.test(await (await fetch(at("/"))).text()));

  const ctrl = new AbortController();
  const res = await fetch(at("/events"), { signal: ctrl.signal });
  const reader = res.body.getReader();
  await reader.read();
  const next = reader.read();
  await act("deliver_reading", { text: "x".repeat(500), nextStep: "Rebase before lunch" });
  assert.match(new TextDecoder().decode((await next).value), /"type":"reading"/);
  ctrl.abort();
  const after = await (await fetch(at("/signs"))).json();
  assert.equal(after.reading.text.length, 400);
  assert.equal(after.reading.nextStep, "Rebase before lunch");

  assert.equal((await fetch(at("/refresh"), { method: "POST", body: JSON.stringify({ branch: "feature" }) })).status, 202);
  const prompt = ext.session.sent.at(-1).prompt;
  assert.match(prompt, /^Use the cast-build-horoscope skill\./);
  assert.ok(!prompt.includes("hot.txt") || prompt.includes('"luckyFile"')); // file names only as a signal value, never contents
  assert.equal((await fetch(at("/refresh"), { method: "POST", body: "x".repeat(5000) })).status, 413);

  await canvas.onClose({ instanceId: "s1" });
  await assert.rejects(fetch(at("/signs")));
});

test("page script has no template literals", async () => {
  const { url } = await canvas.open({ instanceId: "s2" });
  const html = await (await fetch(url)).text();
  const script = html.slice(html.indexOf("<script>"), html.indexOf("</script>"));
  assert.ok(!script.includes("`") && !script.includes("${"));
  await canvas.onClose({ instanceId: "s2" });
});
